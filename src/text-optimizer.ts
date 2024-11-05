export class TextOptimizer {
    private readonly API_URL: string;
    private readonly API_KEY: string;

    constructor(apiKey: string, apiUrl: string) {
        this.API_KEY = apiKey;
        this.API_URL = apiUrl;
    }

    async optimizeText(text: string): Promise<string> {
        const systemPrompt = `You are an expert in optimizing English video subtitles. Improve the following subtitle text while maintaining its original meaning. Output the optimized text directly without any prefix or explanation. Requirements:
1. Combine related short sentences into coherent paragraphs
2. Remove unnecessary repetitions
3. Fix grammar and awkward expressions
4. Maintain semantic coherence and completeness
5. Preserve all important information
6. Make the text more readable and natural
7. Keep the professional terms and proper nouns unchanged
8. Ensure the optimized text sounds natural in English
9. Do not include any prefix like "Here's an optimized version" or similar phrases`;

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