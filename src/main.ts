import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
} from "obsidian";
import { TranscriptView, TRANSCRIPT_TYPE_VIEW } from "./transcript-view";
import { PromptModal } from "./prompt-modal";
import { KimiTranslationService } from "./kimi-translation-service";
import { DeepseekTranslationService } from "./deepseek-translation-service";

interface YTranscriptSettings {
	timestampMod: number;
	lang: string;
	country: string;
	leafUrls: string[];
	enableTranslation: boolean;
	targetLang: string;
	kimiApiKey: string;
	useAITranslation: boolean;
	kimiApiUrl: string;
	minSentences: number;
	maxSentences: number;
	maxWords: number;
	deepseekApiKey: string;
	deepseekApiUrl: string;
	useDeepseek: boolean;
	bilibiliCookie: string;
	bilibiliScriptPath: string;
}

const DEFAULT_SETTINGS: YTranscriptSettings = {
	timestampMod: 5,
	lang: "en",
	country: "EN",
	leafUrls: [],
	enableTranslation: false,
	targetLang: "zh-CN",
	kimiApiKey: '',
	useAITranslation: false,
	kimiApiUrl: 'https://api.moonshot.cn/v1/chat/completions',
	minSentences: 2,
	maxSentences: 4,
	maxWords: 100,
	deepseekApiKey: '',
	deepseekApiUrl: 'https://api.deepseek.com/v1/chat/completions',
	useDeepseek: false,
	bilibiliCookie: '',
	bilibiliScriptPath: '',
};

export default class YTranscriptPlugin extends Plugin {
	settings: YTranscriptSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			TRANSCRIPT_TYPE_VIEW,
			(leaf) => new TranscriptView(leaf, this),
		);

		this.addCommand({
			id: "transcript-from-text",
			name: "Get YouTube/Bilibili transcript from selected url",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				const url = EditorExtensions.getSelectedText(editor).trim();
				this.openView(url);
			},
		});

		this.addCommand({
			id: "transcript-from-prompt",
			name: "Get YouTube/Bilibili transcript from url prompt",
			callback: async () => {
				const prompt = new PromptModal();
				const url: string = await new Promise((resolve) =>
					prompt.openAndGetValue(resolve, () => {}),
				);
				if (url) {
					this.openView(url);
				}
			},
		});

		this.addSettingTab(new YTranslateSettingTab(this.app, this));

		// 添加提示
		new Notice('请确保已运行 Python 服务器：\npython bilibili_subtitle.py --server');

		// 设置 BilibiliTranscript 的配置
		const { BilibiliTranscript } = await import("./bilibili-transcript");
		BilibiliTranscript.setCookie(this.settings.bilibiliCookie);
		BilibiliTranscript.setScriptPath(this.settings.bilibiliScriptPath);
	}

	async openView(url: string) {
		const leaf = this.app.workspace.getRightLeaf(false)!;
		await leaf.setViewState({
			type: TRANSCRIPT_TYPE_VIEW,
		});
		this.app.workspace.revealLeaf(leaf);
		leaf.setEphemeralState({
			url,
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(TRANSCRIPT_TYPE_VIEW);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class YTranslateSettingTab extends PluginSettingTab {
	plugin: YTranscriptPlugin;

	constructor(app: App, plugin: YTranscriptPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 基本设置
		containerEl.createEl("h2", { text: "基本设置" });

		new Setting(containerEl)
			.setName("时间戳间隔")
			.setDesc(
				"设置时间戳在文本中出现的频率（1 - 每行显示，10 - 每10行显示一次）",
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.timestampMod.toFixed())
					.onChange(async (value) => {
						const v = Number.parseInt(value);
						this.plugin.settings.timestampMod = Number.isNaN(v)
							? 5
							: v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("字幕语言")
			.setDesc("首选字幕语言")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.lang)
					.onChange(async (value) => {
						this.plugin.settings.lang = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("国家/地区")
			.setDesc("首选字幕的国家/地区代码")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.country)
					.onChange(async (value) => {
						this.plugin.settings.country = value;
						await this.plugin.saveSettings();
					}),
			);

		// 翻译设置
		containerEl.createEl("h2", { text: "翻译设置" });
		containerEl.createEl("p", { 
			text: "配置翻译设置和 API 密钥",
			cls: "setting-item-description"
		});

		new Setting(containerEl)
			.setName("启用翻译")
			.setDesc("启用双语翻译功能")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableTranslation)
					.onChange(async (value) => {
						this.plugin.settings.enableTranslation = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("目标语言")
			.setDesc("选择翻译的目标语言")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("zh-CN", "中文（简体）")
					.addOption("zh-TW", "中文（繁体）")
					.addOption("ja", "日语")
					.addOption("ko", "韩语")
					.addOption("fr", "法语")
					.addOption("de", "德语")
					.addOption("es", "西班牙语")
					.setValue(this.plugin.settings.targetLang)
					.onChange(async (value) => {
						this.plugin.settings.targetLang = value;
						await this.plugin.saveSettings();
					})
			);

		// AI 翻译设置
		containerEl.createEl("h3", { text: "AI 翻译设置" });

		new Setting(containerEl)
			.setName("使用 AI 翻译")
			.setDesc("使用 Kimi AI 获得更好的翻译质量")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useAITranslation)
					.onChange(async (value) => {
						this.plugin.settings.useAITranslation = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Kimi API 地址")
			.setDesc("Kimi AI 服务的 API 端点")
			.addText((text) =>
				text
					.setPlaceholder("输入 API 地址")
					.setValue(this.plugin.settings.kimiApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiUrl = value;
						await this.plugin.saveSettings();
					})
			);

		const apiKeyDesc = containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "要使用 AI 翻译，您需要提供 Kimi API 密钥。您可以从 Kimi 网站获取密钥。"
		});

		const apiKeyLink = apiKeyDesc.createEl("a", {
			text: "获取 API 密钥",
			href: "https://moonshot.cn/"
		});
		apiKeyLink.setAttr("target", "_blank");

		new Setting(containerEl)
			.setName("Kimi API 密钥")
			.setDesc("Kimi AI 翻译服务的 API 密钥")
			.addText((text) =>
				text
					.setPlaceholder("输入您的 API 密钥")
					.setValue(this.plugin.settings.kimiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// 测试按钮
		new Setting(containerEl)
			.setName("测试 API 连接")
			.setDesc("测试您的 API 设置是否正常工作")
			.addButton((button) => 
				button
					.setButtonText("测试")
					.onClick(async () => {
						const { kimiApiKey, kimiApiUrl } = this.plugin.settings;
						if (!kimiApiKey || !kimiApiUrl) {
							new Notice("请输入 API 密钥和 API 地址");
							return;
						}

						button.setButtonText("测试中...");
						button.setDisabled(true);

						try {
							const translator = new KimiTranslationService(kimiApiKey, kimiApiUrl);
							await translator.translate("Hello, this is a test.", "zh-CN");
							new Notice("API 连接成功！");
						} catch (error) {
							new Notice("API 测试失败: " + error.message);
						} finally {
							button.setButtonText("测试");
							button.setDisabled(false);
						}
					})
			);

		// 段落控制设置
		containerEl.createEl("h2", { text: "段落控制设置" });
		containerEl.createEl("p", { 
			text: "配置字幕段落的划分规则",
			cls: "setting-item-description"
		});

		new Setting(containerEl)
			.setName("最少句子数")
			.setDesc("每个段落至少包含的句子数量")
			.addSlider((slider) =>
				slider
					.setLimits(1, 5, 1)
					.setValue(this.plugin.settings.minSentences)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.minSentences = value;
						// 确保最小值不大于最大值
						if (value > this.plugin.settings.maxSentences) {
							this.plugin.settings.maxSentences = value;
						}
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("最多句子数")
			.setDesc("每个段落最多包含的句子数量")
			.addSlider((slider) =>
				slider
					.setLimits(2, 10, 1)
					.setValue(this.plugin.settings.maxSentences)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxSentences = value;
						// 确保最大值不小于最小值
						if (value < this.plugin.settings.minSentences) {
							this.plugin.settings.minSentences = value;
						}
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("最大单词数")
			.setDesc("每个段落最多包含的单词数量")
			.addSlider((slider) =>
				slider
					.setLimits(50, 200, 10)
					.setValue(this.plugin.settings.maxWords)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxWords = value;
						await this.plugin.saveSettings();
					})
			);

		// 添加重置按钮
		new Setting(containerEl)
			.setName("重置段落设置")
			.setDesc("将段落控制设置恢复默认值")
			.addButton((button) => 
				button
					.setButtonText("重置")
					.onClick(async () => {
						this.plugin.settings.minSentences = DEFAULT_SETTINGS.minSentences;
						this.plugin.settings.maxSentences = DEFAULT_SETTINGS.maxSentences;
						this.plugin.settings.maxWords = DEFAULT_SETTINGS.maxWords;
						await this.plugin.saveSettings();
						// 刷新设置页面
						this.display();
						new Notice("段落设置已重置为默认值");
					})
			);

		// DeepSeek AI 设置
		containerEl.createEl("h3", { text: "DeepSeek AI 设置" });

		new Setting(containerEl)
			.setName("使用 DeepSeek AI")
			.setDesc("使用 DeepSeek AI 进行翻译")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useDeepseek)
					.onChange(async (value) => {
						this.plugin.settings.useDeepseek = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("DeepSeek API 地址")
			.setDesc("DeepSeek AI 服务的 API 端点")
			.addText((text) =>
				text
					.setPlaceholder("输入 API 地址")
					.setValue(this.plugin.settings.deepseekApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.deepseekApiUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("DeepSeek API 密钥")
			.setDesc("DeepSeek AI 服务的 API 密钥")
			.addText((text) =>
				text
					.setPlaceholder("输入您的 API 密钥")
					.setValue(this.plugin.settings.deepseekApiKey)
					.onChange(async (value) => {
						this.plugin.settings.deepseekApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// 添加 DeepSeek API 测试按钮
		new Setting(containerEl)
			.setName("测试 DeepSeek API")
			.setDesc("测试 DeepSeek API 连接是否正常")
			.addButton((button) => 
				button
					.setButtonText("测试")
					.onClick(async () => {
						const { deepseekApiKey, deepseekApiUrl } = this.plugin.settings;
						if (!deepseekApiKey || !deepseekApiUrl) {
							new Notice("请输入 DeepSeek API 密钥和 API 地址");
							return;
						}

						button.setButtonText("测试中...");
						button.setDisabled(true);

						try {
							const translator = new DeepseekTranslationService(deepseekApiKey, deepseekApiUrl);
							await translator.translate("Hello, this is a test.", "zh-CN");
							new Notice("DeepSeek API 连接成功！");
						} catch (error) {
							new Notice("DeepSeek API 测试失败: " + error.message);
						} finally {
							button.setButtonText("测试");
							button.setDisabled(false);
						}
					})
			);

		// 添加B站设置部分
		containerEl.createEl("h2", { text: "Bilibili 设置" });

		new Setting(containerEl)
			.setName("Bilibili Cookie")
			.setDesc("设置B站cookie以获取完整访问权限（可选）")
			.addText((text) =>
				text
					.setPlaceholder("输入您的B站cookie")
					.setValue(this.plugin.settings.bilibiliCookie)
					.onChange(async (value) => {
						this.plugin.settings.bilibiliCookie = value;
						// 更新BilibiliTranscript的cookie
						const { BilibiliTranscript } = await import("./bilibili-transcript");
						BilibiliTranscript.setCookie(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Python 脚本路径")
			.setDesc("设置 bilibili_subtitle.py 脚本的路径（可选，留空使用默认路径）")
			.addText((text) =>
				text
					.setPlaceholder("输入脚本完整路径")
					.setValue(this.plugin.settings.bilibiliScriptPath)
					.onChange(async (value) => {
						this.plugin.settings.bilibiliScriptPath = value;
						await this.plugin.saveSettings();
					})
			);

		// 添加B站连接测试
		new Setting(containerEl)
			.setName("测试 Bilibili 连接")
			.setDesc("测试 Cookie 设置和字获取是否正常")
			.addText(text => text
				.setPlaceholder("输入BV号进行测试")
				.setValue("")
			)
			.addButton(button => button
				.setButtonText("测试")
				.onClick(async (evt) => {
					const bvid = (evt.target as HTMLElement)
						.parentElement?.parentElement
						?.querySelector('input')?.value;
					
					if (!bvid) {
						new Notice("请输入要测试的视频BV号");
						return;
					}

					button.setButtonText("测试中...");
					button.setDisabled(true);

					try {
						const { BilibiliTranscript } = await import("./bilibili-transcript");
						const result = await BilibiliTranscript.testConnection(bvid);

						if (result.success) {
							let message = result.message;
							if (result.details?.subtitles) {
								message += "\n\n字幕示例：\n" + 
									result.details.subtitles
										.map((s: any) => s.content)
										.join("\n");
							}
							new Notice(message, 5000);
						} else {
							new Notice("测试失败: " + result.message);
						}
					} catch (error) {
						new Notice("测试出错: " + error.message);
					} finally {
						button.setButtonText("测试");
						button.setDisabled(false);
					}
				})
			);
	}
}

const EditorExtensions = {
	getSelectedText: (editor: Editor): string => {
		if (editor.somethingSelected()) {
			return editor.getSelection();
		}
		return "";
	}
};
