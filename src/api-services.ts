// API服务基础接口
export interface APIService {
    name: string;
    apiKey: string;
    apiUrl: string;
    translate(text: string, targetLang: string): Promise<string>;
    optimize(text: string): Promise<string>;
}

// API服务工厂
export class APIServiceFactory {
    static createKimiService(apiKey: string, apiUrl: string): APIService {
        return {
            name: 'Kimi',
            apiKey,
            apiUrl,
            async translate(text: string, targetLang: string) {
                const { KimiTranslationService } = await import("./kimi-translation-service");
                const translator = new KimiTranslationService(this.apiKey, this.apiUrl);
                return translator.translate(text, targetLang);
            },
            async optimize(text: string) {
                const { TextOptimizer } = await import("./text-optimizer");
                const optimizer = new TextOptimizer(this.apiKey, this.apiUrl);
                // 使用英文提示词，保持原文语言
                return optimizer.optimizeText(
                    `Please optimize the following text to make it more fluent and natural, while maintaining its original language:\n${text}`
                );
            }
        };
    }

    static createDeepSeekService(apiKey: string, apiUrl: string): APIService {
        return {
            name: 'DeepSeek',
            apiKey,
            apiUrl,
            async translate(text: string, targetLang: string) {
                const { DeepseekTranslationService } = await import("./deepseek-translation-service");
                const translator = new DeepseekTranslationService(this.apiKey, this.apiUrl);
                return translator.translate(text, targetLang);
            },
            async optimize(text: string) {
                const { DeepseekTranslationService } = await import("./deepseek-translation-service");
                const service = new DeepseekTranslationService(this.apiKey, this.apiUrl);
                // 使用英文提示词，保持原文语言
                return service.translate(
                    `Please optimize the following text to make it more fluent and natural, while maintaining its original language:\n${text}`,
                    'auto' // 使用自动语言检测
                );
            }
        };
    }

    static getService(settings: any): APIService | null {
        if (settings.useDeepseek && settings.deepseekApiKey) {
            return this.createDeepSeekService(
                settings.deepseekApiKey,
                settings.deepseekApiUrl
            );
        } else if (settings.kimiApiKey) {
            return this.createKimiService(
                settings.kimiApiKey,
                settings.kimiApiUrl
            );
        }
        return null;
    }
} 