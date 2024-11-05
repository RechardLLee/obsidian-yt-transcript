import { TranslationService } from "./translation-service";

export class DeepseekTranslationService implements TranslationService {
    private readonly API_URL: string;
    private readonly API_KEY: string;

    constructor(apiKey: string, apiUrl: string = 'https://api.deepseek.com/v1/chat/completions') {
        this.API_KEY = apiKey;
        this.API_URL = apiUrl;
    }

    async translate(text: string, targetLang: string): Promise<string> {
        const systemPrompt = `你是一位专业的视频字幕翻译专家。请将以下英文字幕翻译成流畅的${targetLang === 'zh-CN' ? '中文' : targetLang}。直接输出翻译结果，不要添加任何前缀说明。
要求：
1. 保持原文的意思和语气
2. 使用自然、地道的表达
3. 注意专业术语的准确翻译
4. 保持句子的连贯性和上下文关系
5. 适当调整语序，使译文更符合中文表达习惯
6. 对于文化相关的内容，进行恰当的本地化处理
7. 确保译文通顺易读，符合中文语言习惯
8. 不要添加任何前缀或说明文字`;

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.API_KEY}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: text
                        }
                    ],
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error: any) {
            console.error("DeepSeek translation failed:", error);
            throw new Error(error?.message || 'DeepSeek 翻译服务出错');
        }
    }
} 