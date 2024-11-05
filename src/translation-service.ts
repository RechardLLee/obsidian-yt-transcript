export interface TranslationService {
    translate(text: string, targetLang: string, onProgress?: (text: string) => void): Promise<string>;
}

export class GoogleTranslationService implements TranslationService {
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000; // 1秒

    async translate(text: string, targetLang: string, onProgress?: (text: string) => void): Promise<string> {
        let retries = 0;
        
        while (retries < this.MAX_RETRIES) {
            try {
                const response = await fetch(
                    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
                );
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                if (!data || !data[0]) {
                    throw new Error('无效的响应格式');
                }
                
                const translatedText = data[0]
                    .filter((item: any[]) => item && item[0])
                    .map((item: any[]) => item[0])
                    .join('');
                
                if (onProgress) {
                    onProgress(translatedText);
                }
                
                return translatedText;
            } catch (error: any) {
                retries++;
                if (retries === this.MAX_RETRIES) {
                    console.error("翻译失败:", error);
                    throw new Error(error?.message || '翻译服务出错，请稍后重试');
                }
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
            }
        }
        
        throw new Error('翻译服务暂时不可用');
    }
} 