// API服务基础接口
export interface APIService {
    name: string;
    apiKey: string;
    apiUrl: string;
    translate(text: string, targetLang: string, onProgress?: (text: string) => void): Promise<string>;
    optimize(text: string, onProgress?: (text: string) => void): Promise<string>;
}

// API服务工厂
export class APIServiceFactory {
    static createKimiService(apiKey: string, apiUrl: string): APIService {
        return {
            name: 'Kimi',
            apiKey,
            apiUrl,
            async translate(text: string, targetLang: string, onProgress?: (text: string) => void) {
                const { KimiTranslationService } = await import("./kimi-translation-service");
                const translator = new KimiTranslationService(this.apiKey, this.apiUrl);
                return translator.translate(text, targetLang, onProgress);
            },
            async optimize(text: string, onProgress?: (text: string) => void) {
                const { TextOptimizer } = await import("./text-optimizer");
                const optimizer = new TextOptimizer(this.apiKey, this.apiUrl);
                return optimizer.optimizeText(
                    `Please optimize the following text to make it more fluent and natural, while maintaining its original language:\n${text}`,
                    onProgress
                );
            }
        };
    }

    static createDeepSeekService(apiKey: string, apiUrl: string): APIService {
        return {
            name: 'DeepSeek',
            apiKey,
            apiUrl,
            async translate(text: string, targetLang: string, onProgress?: (text: string) => void) {
                const { DeepseekTranslationService } = await import("./deepseek-translation-service");
                const translator = new DeepseekTranslationService(this.apiKey, this.apiUrl);
                return translator.translate(text, targetLang, onProgress);
            },
            async optimize(text: string, onProgress?: (text: string) => void) {
                const { DeepseekTranslationService } = await import("./deepseek-translation-service");
                const service = new DeepseekTranslationService(this.apiKey, this.apiUrl);
                return service.translate(
                    `Please optimize the following text to make it more fluent and natural, while maintaining its original language:\n${text}`,
                    'auto',
                    onProgress
                );
            }
        };
    }

    static getService(settings: any): APIService | null {
        switch (settings.selectedAIService) {
            case 'kimi':
                if (settings.kimiApiKey) {
                    return this.createKimiService(
                        settings.kimiApiKey,
                        settings.kimiApiUrl
                    );
                }
                break;
            case 'deepseek':
                if (settings.deepseekApiKey) {
                    return this.createDeepSeekService(
                        settings.deepseekApiKey,
                        settings.deepseekApiUrl
                    );
                }
                break;
        }
        return null;
    }
} 