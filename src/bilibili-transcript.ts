export class BilibiliTranscriptError extends Error {
    constructor(err: unknown) {
        if (!(err instanceof Error)) {
            super("");
            return;
        }

        if (err.message.includes("ERR_INVALID_URL")) {
            super("无效的 Bilibili URL");
        } else {
            super(err.message);
        }
    }
}

export interface BilibiliTranscriptConfig {
    lang?: string;
}

export interface BilibiliTranscriptResponse {
    title: string;
    lines: BilibiliTranscriptLine[];
}

export interface BilibiliTranscriptLine {
    text: string;
    duration: number;
    offset: number;
}

export class BilibiliTranscript {
    private static cookie: string = '';
    private static scriptPath: string = '';

    public static setCookie(cookie: string) {
        this.cookie = cookie;
    }

    public static setScriptPath(path: string) {
        this.scriptPath = path;
    }

    private static getScriptPath(): string {
        if (this.scriptPath) {
            return this.scriptPath;  // 使用用户设置的路径
        }

        const path = require('path');
        const fs = require('fs');

        // 使用 Obsidian API 获取插件目录路径
        // @ts-ignore
        const pluginDir = (app?.vault?.adapter as any)?.basePath || '';
        
        // 尝试多个可能的路径
        const possiblePaths = [
            // 用户设置的路径
            this.scriptPath,
            // Obsidian 插件目录路径
            path.join(pluginDir, '.obsidian', 'plugins', 'ytranscript', 'scripts', 'bilibili_subtitle.py'),
            // 相对于插件目录的路径
            path.join(__dirname, '..', 'scripts', 'bilibili_subtitle.py'),
            // 相对于当前文件的路径
            path.join(__dirname, 'scripts', 'bilibili_subtitle.py'),
            // 开发环境路径
            path.join(process.cwd(), 'scripts', 'bilibili_subtitle.py')
        ].filter(Boolean); // 过滤掉空值

        // 确保路径中不包含特殊字符
        const sanitizePath = (p: string) => {
            if (!p) return '';
            // 移除路径中的特殊字符和多余的空格
            return p.replace(/\s+/g, ' ').trim();
        };

        // 查找第一个存在的路径
        for (const p of possiblePaths) {
            const sanitizedPath = sanitizePath(p);
            if (sanitizedPath && fs.existsSync(sanitizedPath)) {
                console.log('找到脚本路径:', sanitizedPath);
                return sanitizedPath;
            }
        }

        // 如果找不到脚本，抛出更详细的错误信息
        const error = new Error('找不到 Python 脚本文件');
        error.message += '\n尝试过以下路径：\n' + possiblePaths.map(p => `- ${p}`).join('\n');
        error.message += '\n请在设置中指定正确的脚本路径';
        throw error;
    }

    public static async fetchTranscript(
        url: string,
        config?: BilibiliTranscriptConfig
    ): Promise<BilibiliTranscriptResponse> {
        try {
            const bvid = this.extractBvid(url);
            if (!bvid) {
                throw new Error("无法识别的 Bilibili 视频链接");
            }

            const { spawn } = require('child_process');
            const scriptPath = this.getScriptPath();
            const nodeProcess = require('process');
            
            const pythonProcess = spawn('python', [scriptPath, bvid, '--cookie', this.cookie || ''], {
                env: {
                    ...nodeProcess.env,
                    PYTHONIOENCODING: 'utf-8',
                    LANG: 'zh_CN.UTF-8'
                }
            });
            
            return new Promise<BilibiliTranscriptResponse>((resolve, reject) => {
                let output = '';
                let error = '';

                pythonProcess.stdout.on('data', (data: Buffer) => {
                    const chunk = data.toString('utf-8');
                    output += chunk;
                });

                pythonProcess.stderr.on('data', (data: Buffer) => {
                    const chunk = data.toString('utf-8');
                    error += chunk;
                });

                pythonProcess.on('error', (err: Error) => {
                    console.error('启动Python进程失败:', err);
                    reject(new Error(`启动Python进程失败: ${err.message}`));
                });

                pythonProcess.on('close', (code: number) => {
                    if (code === 0) {
                        try {
                            // 解析输出内容
                            const lines = output.split('\n');
                            let title = '';
                            const subtitles: BilibiliTranscriptLine[] = [];

                            for (const line of lines) {
                                if (line.startsWith('标题:')) {
                                    title = line.substring(3).trim();
                                } else if (line.startsWith('字幕:')) {
                                    try {
                                        const subtitleJson = line.substring(3).trim();
                                        const subtitle = JSON.parse(subtitleJson);
                                        if (subtitle && subtitle.from !== undefined && subtitle.to !== undefined && subtitle.content) {
                                            subtitles.push({
                                                text: subtitle.content.trim(),
                                                offset: Math.round(subtitle.from * 1000),
                                                duration: Math.round((subtitle.to - subtitle.from) * 1000)
                                            });
                                        }
                                    } catch (e) {
                                        console.warn('解析字幕行失败:', line);
                                    }
                                }
                            }

                            if (!title || subtitles.length === 0) {
                                console.error('解析结果:', { title, subtitlesCount: subtitles.length });
                                throw new Error('未找到有效的标题或字幕数据');
                            }

                            resolve({
                                title,
                                lines: subtitles
                            });
                        } catch (e) {
                            console.error('原始输出:', output);
                            reject(new Error(`解析字幕数据失败：${e.message}`));
                        }
                    } else {
                        reject(new Error(`Python脚本执行失败 (代码 ${code}): ${error || output}`));
                    }
                });
            });
        } catch (err: any) {
            console.error("获取字幕失败:", err);
            throw new BilibiliTranscriptError(err);
        }
    }

    // 添加合并短字幕的方法
    private static mergeShortSubtitles(lines: BilibiliTranscriptLine[]): BilibiliTranscriptLine[] {
        const MIN_DURATION = 1000; // 最小持续时间（毫秒）
        const MAX_GAP = 500;      // 最大间隔时间（毫秒）
        
        return lines.reduce((acc: BilibiliTranscriptLine[], current: BilibiliTranscriptLine, index: number) => {
            if (acc.length === 0) {
                return [current];
            }

            const last = acc[acc.length - 1];
            const gap = current.offset - (last.offset + last.duration);

            // 如果当前字幕持续时间太短，或者与前一个字幕间隔很小，就合并
            if (current.duration < MIN_DURATION || gap < MAX_GAP) {
                last.text += ' ' + current.text;
                last.duration = current.offset + current.duration - last.offset;
                return acc;
            }

            return [...acc, current];
        }, []);
    }

    private static extractBvid(url: string): string | null {
        const bvidMatch = url.match(/BV[a-zA-Z0-9]+/);
        return bvidMatch ? bvidMatch[0] : null;
    }

    public static async testConnection(bvid: string): Promise<{
        success: boolean;
        message: string;
        details?: {
            videoInfo?: any;
            subtitles?: any;
        };
    }> {
        try {
            const scriptPath = this.getScriptPath();
            console.log('使用脚本路径:', scriptPath);

            const { spawn } = require('child_process');
            
            // 使用 spawn 时确保路径正确
            const process = spawn('python', [scriptPath, bvid, '--cookie', this.cookie || '']);
            
            return new Promise((resolve, reject) => {
                let output = '';
                let error = '';

                process.stdout.on('data', (data: any) => {
                    output += data.toString();
                    console.log('Python 输出:', data.toString());
                });

                process.stderr.on('data', (data: any) => {
                    error += data.toString();
                    console.error('Python 错误:', data.toString());
                });

                process.on('error', (err: any) => {
                    console.error('启动 Python 进程失败:', err);
                    reject(new Error(`启动 Python 进程失败: ${err.message}`));
                });

                process.on('close', (code: number) => {
                    if (code === 0) {
                        try {
                            const parsedResult = JSON.parse(output);
                            resolve({
                                success: true,
                                message: "连接成功，成功获取字幕",
                                details: {
                                    videoInfo: {
                                        title: parsedResult.title
                                    },
                                    subtitles: parsedResult.lines?.slice(0, 3)
                                }
                            });
                        } catch (e) {
                            reject(new Error(`解析输出失败: ${e.message}\n输出内容: ${output}`));
                        }
                    } else {
                        reject(new Error(`Python 脚本执行失败 (代码 ${code}): ${error || output}`));
                    }
                });
            });
        } catch (error: any) {
            return {
                success: false,
                message: `测试连接失败: ${error.message}`,
            };
        }
    }
} 