export class TextOptimizer {
    private readonly API_URL: string;
    private readonly API_KEY: string;

    constructor(apiKey: string, apiUrl: string) {
        this.API_KEY = apiKey;
        this.API_URL = apiUrl;
    }

    async optimizeText(text: string, onProgress?: (text: string) => void): Promise<string> {
        // 检测文本语言
        const isChineseText = this.isChineseText(text);
        
        const systemPrompt = isChineseText ? 
            // 中文优化提示词
            `作为专业的视频字幕编辑专家，请优化以下中文字幕文本，使其更加流畅自然。要求：
1. 保持原文的语义和语气
2. 修正不自然的表达
3. 保持语义连贯性和完整性
4. 保留所有重要信息
5. 提高可读性和自然度
6. 保持专业术语不变
7. 确保优化后的文本听起来自然
8. 直接输出优化后的中文文本，不要翻译成其他语言
9. 不要改变原文的分段和格式
10. 不要添加任何额外的标点符号或换行
11. 不要将中文翻译成英文` :
            // 英文优化提示词
            `As a professional video subtitle editor, please optimize the following English subtitle text while maintaining its original language. Requirements:
1. Keep the original meaning and tone
2. Fix unnatural expressions
3. Maintain semantic coherence
4. Preserve all important information
5. Improve readability and naturalness
6. Keep technical terms unchanged
7. Ensure the optimized text sounds natural
8. Output the optimized English text directly, do not translate
9. Do not change the original paragraph structure
10. Do not add any extra punctuation or line breaks
11. Do not translate English to Chinese`;

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
                    stream: true
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            let result = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = new TextDecoder().decode(value);
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices[0].delta.content) {
                                result += data.choices[0].delta.content;
                                if (onProgress) {
                                    onProgress(result);
                                }
                            }
                        }
                    }
                }
            }

            return result;
        } catch (error: any) {
            console.error("Text optimization failed:", error);
            throw new Error(error?.message || '文本优化失败');
        }
    }

    private isChineseText(text: string): boolean {
        // 检查是否包含中文字符
        const chineseRegex = /[\u4e00-\u9fa5]/;
        // 计算中文字符的比例
        const chineseChars = text.split('').filter(char => chineseRegex.test(char));
        const chineseRatio = chineseChars.length / text.length;
        // 如果中文字符占比超过10%，认为是中文内容（降低阈值以更好地检测中文）
        return chineseRatio > 0.1;
    }
} 