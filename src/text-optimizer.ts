export class TextOptimizer {
    private readonly API_URL: string;
    private readonly API_KEY: string;

    constructor(apiKey: string, apiUrl: string) {
        this.API_KEY = apiKey;
        this.API_URL = apiUrl;
    }

    async optimizeText(text: string): Promise<string> {
        const systemPrompt = `作为专业的视频字幕编辑专家，请优化以下英文字幕文本，保持原意的同时使其更加流畅自然。要求：
1. 合并相关的短句成连贯段落
2. 删除不必要的重复内容
3. 修正语法和不自然的表达
4. 保持语义连贯性和完整性
5. 保留所有重要信息
6. 提高可读性和自然度
7. 保持专业术语和专有名词不变
8. 确保优化后的文本听起来自然
9. 直接输出优化后的文本，不要添加任何前缀说明`;

        const userPrompt = text;

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.API_KEY}`
                },
                body: JSON.stringify({
                    model: "kimi",
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: userPrompt
                        }
                    ],
                    use_search: false,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error: any) {
            console.error("Text optimization failed:", error);
            throw new Error(error?.message || '文本优化失败');
        }
    }
} 