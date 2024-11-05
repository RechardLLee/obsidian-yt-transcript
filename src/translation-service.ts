export interface TranslationService {
    translate(text: string, targetLang: string): Promise<string>;
}

export class GoogleTranslationService implements TranslationService {
    async translate(text: string, targetLang: string): Promise<string> {
        try {
            const response = await fetch(
                `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            if (!data || !data[0]) {
                throw new Error('Invalid response format');
            }
            
            // 合并所有翻译片段
            const translatedText = data[0]
                .filter((item: any[]) => item && item[0])
                .map((item: any[]) => item[0])
                .join('');
            
            return translatedText;
        } catch (error: any) {
            console.error("Translation failed:", error);
            throw new Error(error?.message || '翻译服务出错');
        }
    }
} 