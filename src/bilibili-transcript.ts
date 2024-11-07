import * as path from 'path';

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
    useAI?: boolean;
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
            const bvidWithP = this.extractBvid(url);
            if (!bvidWithP) {
                throw new Error("无法识别的 Bilibili 视频链接");
            }

            const { spawn } = require('child_process');
            const scriptPath = this.getScriptPath();
            const nodeProcess = require('process');
            
            // 将 bvidWithP 分割成参数数组
            const pythonArgs = [scriptPath, ...bvidWithP.split(' '), '--cookie', this.cookie || ''];
            
            const pythonProcess = spawn('python', pythonArgs, {
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

                            // 如果没有启用AI优化，则进行基本的字幕整理
                            if (!config?.useAI) {
                                const optimizedSubtitles = this.optimizeSubtitles(subtitles);
                                resolve({
                                    title,
                                    lines: optimizedSubtitles
                                });
                            } else {
                                resolve({
                                    title,
                                    lines: subtitles
                                });
                            }
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
        const MIN_DURATION = 1000;
        const MAX_GAP = 300;
        const MAX_MERGE_LENGTH = 50; // 减小最大合并长度限制
        
        return lines.reduce((acc: BilibiliTranscriptLine[], current: BilibiliTranscriptLine, index: number) => {
            if (acc.length === 0) {
                return [current];
            }

            const last = acc[acc.length - 1];
            const gap = current.offset - (last.offset + last.duration);
            const mergedTextLength = (last.text + current.text).length;

            // 判断是否应该合并
            const shouldMerge = 
                (current.duration < MIN_DURATION || gap < MAX_GAP) && 
                mergedTextLength <= MAX_MERGE_LENGTH &&
                !this.isCompleteSentence(last.text);

            if (shouldMerge) {
                last.text = `${last.text}${current.text}`;
                last.duration = current.offset + current.duration - last.offset;
                return acc;
            }

            return [...acc, current];
        }, []);
    }

    // 判断是否是完整句子
    private static isCompleteSentence(text: string): boolean {
        // 检查是否以句号、问号、感叹号结尾
        if (/[。！？]$/.test(text)) {
            return true;
        }
        
        // 检查是否包含完整的语义单位
        const semanticUnits = [
            '但是', '所以', '因此', '然后', '接着', '不过', 
            '而且', '并且', '另外', '总之', '其实', '事实上'
        ];
        
        return semanticUnits.some(unit => text.includes(unit));
    }

    private static extractBvid(url: string): string | null {
        // 提取 BV 号和分P参数
        const bvidMatch = url.match(/BV[a-zA-Z0-9]+/);
        const pMatch = url.match(/[?&]p=(\d+)/);
        
        if (!bvidMatch) return null;
        
        const bvid = bvidMatch[0];
        const p = pMatch ? `--p ${pMatch[1]}` : '';  // 如果有分P参数就添加
        
        return p ? `${bvid} ${p}` : bvid;
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
            
            // 处理可能包含分P参数的 bvid
            const args = bvid.split(' ');
            const pythonArgs = [scriptPath, ...args, '--cookie', this.cookie || ''];
            
            // 使用 spawn 时确保路径正确
            const process = spawn('python', pythonArgs);
            
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

    // 添加字幕优化方法
    private static optimizeSubtitles(subtitles: BilibiliTranscriptLine[]): BilibiliTranscriptLine[] {
        // 1. 过滤掉无效字幕
        const validSubtitles = subtitles.filter(line => 
            line.text && 
            line.text.trim() !== '' && 
            line.duration > 0 &&
            line.offset >= 0
        );

        // 2. 合并短句
        const mergedSubtitles = this.mergeShortSubtitles(validSubtitles);
        
        // 3. 清理文本
        const cleanedSubtitles = mergedSubtitles.map(line => ({
            ...line,
            text: this.cleanText(line.text)
        }));

        // 4. 按时间排序并移除重复
        const sortedSubtitles = cleanedSubtitles
            .sort((a, b) => a.offset - b.offset)
            .filter((line, index, self) => 
                index === 0 || line.text !== self[index - 1].text
            );

        // 5. 确保字幕时长合
        return sortedSubtitles.map((line, index, array) => {
            // 如果不是最后一条字幕，使用下一条字幕的开始时间来计算持续时间
            if (index < array.length - 1) {
                const nextOffset = array[index + 1].offset;
                const duration = nextOffset - line.offset;
                return {
                    ...line,
                    duration: Math.max(duration, 1000) // 确保至少1秒
                };
            }
            return {
                ...line,
                duration: Math.max(line.duration, 1000) // 确保最后一条字幕至少1秒
            };
        });
    }

    private static cleanText(text: string): string {
        // 检测是否主要是英文文本
        const englishMatches = text.match(/[a-zA-Z]/g);
        const chineseMatches = text.match(/[\u4e00-\u9fa5]/g);
        
        // 使用可选链和空值合并运算符来安全处理可能为null的匹配结果
        const isEnglish = (englishMatches?.length || 0) > (chineseMatches?.length || 0);
        
        if (isEnglish) {
            // 处理英文文本
            return this.cleanEnglishText(text);
        } else {
            // 处理中文文本
            return this.cleanChineseText(text);
        }
    }

    private static cleanEnglishText(text: string): string {
        // 1. 修复常见的标点问题
        let result = text
            .replace(/\s+/g, ' ')  // 合并多个空格
            .replace(/([.!?])\s*([a-zA-Z])/g, '$1 $2')  // 确保句号后有空格
            .replace(/\s+([,.!?])/g, '$1')  // 移除标点前的空格
            .replace(/([a-zA-Z])'([a-zA-Z])/g, "$1'$2")  // 修复撇号
            .trim();
        
        // 2. 添加缺失的句号
        if (!/[.!?]$/.test(result)) {
            result += '.';
        }
        
        // 3. 确保句子首字母大写
        result = result.replace(/([.!?]\s+)([a-z])/g, (match, p1, p2) => 
            p1 + p2.toUpperCase()
        );
        
        return result;
    }

    private static cleanChineseText(text: string): string {
        // 1. 基础清理
        let cleanText = text
            .replace(/\s+/g, '')  // 移除所有空格
            .replace(/[【】\[\]]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/\{.*?\}/g, '')
            .trim();
        
        // 2. 先按明显的句子结束符分段
        let segments = cleanText.split(/([。！？]+)/).map((part, index, array) => {
            // 如果是标点符号，附加到前一段
            if (index % 2 === 1) {
                return '';
            }
            // 如果下一个是标点，加上标点
            if (array[index + 1]) {
                return part + array[index + 1];
            }
            // 最后一段如果没有标点，加上句号
            return part + (part ? '。' : '');
        }).filter(Boolean);

        // 3. 处理过长的段落
        segments = segments.reduce((acc: string[], segment) => {
            if (segment.length <= 50) {
                acc.push(segment);
                return acc;
            }

            // 按逗号分割长句
            const parts = segment.split(/([，,])/);
            let currentPart = '';

            for (let i = 0; i < parts.length; i += 2) {
                const text = parts[i];
                const comma = parts[i + 1] || '';
                
                if ((currentPart + text).length > 40) {
                    if (currentPart) {
                        acc.push(currentPart + '。');
                    }
                    currentPart = text + comma;
                } else {
                    currentPart += text + comma;
                }
            }

            if (currentPart) {
                acc.push(currentPart);
            }

            return acc;
        }, []);

        // 4. 进一步处理分段
        segments = segments.map(segment => {
            // 在转折词前添加分段
            const transitionWords = ['但是', '然而', '不过', '可是', '因此', '所以', '于是', '然后'];
            for (const word of transitionWords) {
                if (segment.includes(word)) {
                    segment = segment.replace(word, `。${word}`);
                }
            }
            return segment;
        });

        // 5. 确保每段都有合适的标点结尾
        segments = segments.map(segment => {
            segment = segment.trim();
            if (!segment.match(/[。！？]$/)) {
                segment += '。';
            }
            return segment;
        });

        // 6. 合并过短的段落
        const finalSegments = [];
        let tempSegment = '';

        for (const segment of segments) {
            if (tempSegment.length + segment.length < 30) {
                tempSegment += segment;
            } else {
                if (tempSegment) {
                    finalSegments.push(tempSegment);
                }
                tempSegment = segment;
            }
        }

        if (tempSegment) {
            finalSegments.push(tempSegment);
        }

        return finalSegments.join('\n');
    }
} 