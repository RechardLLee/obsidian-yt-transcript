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
import { APIServiceFactory } from "./api-services";

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
	useAIOptimization: boolean;
	selectedAIService: 'kimi' | 'deepseek' | null;
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
	useAIOptimization: false,
	selectedAIService: null,
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
			.setDesc("设置时间戳在文本中出现的频率（1 - 每行显示，10 - 每10行显示一次）")
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

		// AI 服务选择
		containerEl.createEl("h2", { text: "AI 服务设置" });

		new Setting(containerEl)
			.setName("选择 AI 服务")
			.setDesc("选择要使用的 AI 服务")
			.addDropdown(dropdown => dropdown
				.addOption('', '不使用 AI')
				.addOption('kimi', 'Kimi AI')
				.addOption('deepseek', 'DeepSeek AI')
				.setValue(this.plugin.settings.selectedAIService || '')
				.onChange(async (value) => {
					this.plugin.settings.selectedAIService = value as 'kimi' | 'deepseek' | null;
					await this.plugin.saveSettings();
				}));

		// Kimi AI 设置
		containerEl.createEl("h3", { text: "Kimi AI 设置" });
		
		const kimiContainer = containerEl.createDiv('kimi-settings-container');
		
		new Setting(kimiContainer)
			.setName("Kimi API密钥")
			.setDesc("设置Kimi AI服务的API密钥")
			.addText((text) =>
				text
					.setPlaceholder("输入Kimi API密钥")
					.setValue(this.plugin.settings.kimiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(kimiContainer)
			.setName("Kimi API地址")
			.setDesc("设置Kimi AI服务的API地址")
			.addText((text) =>
				text
					.setPlaceholder("输入Kimi API地址")
					.setValue(this.plugin.settings.kimiApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiUrl = value;
						await this.plugin.saveSettings();
					})
			);

		// 添加测试按钮
		new Setting(kimiContainer)
			.setName("测试 Kimi API")
			.setDesc("测试 API 连接是否正常")
			.addButton((button) => button
				.setButtonText("测试连接")
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("测试中...");
					try {
						const apiService = APIServiceFactory.createKimiService(
							this.plugin.settings.kimiApiKey,
							this.plugin.settings.kimiApiUrl
						);
						await apiService.translate("Hello, this is a test message.", "zh-CN");
						new Notice("Kimi API 连接测试成功！");
					} catch (error) {
						console.error("Kimi API 测试失败:", error);
						new Notice(`Kimi API 测试失败: ${error.message}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText("测试连接");
					}
				}));

		// DeepSeek AI 设置
		containerEl.createEl("h3", { text: "DeepSeek AI 设置" });
		
		const deepseekContainer = containerEl.createDiv('deepseek-settings-container');

		new Setting(deepseekContainer)
			.setName("DeepSeek API密钥")
			.setDesc("设置DeepSeek AI服务的API密钥")
			.addText((text) =>
				text
					.setPlaceholder("输入DeepSeek API密钥")
					.setValue(this.plugin.settings.deepseekApiKey)
					.onChange(async (value) => {
						this.plugin.settings.deepseekApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(deepseekContainer)
			.setName("DeepSeek API地址")
			.setDesc("设置DeepSeek AI服务的API地址")
			.addText((text) =>
				text
					.setPlaceholder("输入DeepSeek API地址")
					.setValue(this.plugin.settings.deepseekApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.deepseekApiUrl = value;
						await this.plugin.saveSettings();
					})
			);

		// 添加测试按钮
		new Setting(deepseekContainer)
			.setName("测试 DeepSeek API")
			.setDesc("测试 API 连接是否正常")
			.addButton((button) => button
				.setButtonText("测试连接")
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("测试中...");
					try {
						const apiService = APIServiceFactory.createDeepSeekService(
							this.plugin.settings.deepseekApiKey,
							this.plugin.settings.deepseekApiUrl
						);
						await apiService.translate("Hello, this is a test message.", "zh-CN");
						new Notice("DeepSeek API 连接测试成功！");
					} catch (error) {
						console.error("DeepSeek API 测试失败:", error);
						new Notice(`DeepSeek API 测试失败: ${error.message}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText("测试连接");
					}
				}));

		// B站设置
		containerEl.createEl("h2", { text: "B站设置" });

		new Setting(containerEl)
			.setName("Cookie")
			.setDesc("设置B站cookie（可选）")
			.addText((text) =>
				text
					.setPlaceholder("输入B站cookie")
					.setValue(this.plugin.settings.bilibiliCookie)
					.onChange(async (value) => {
						this.plugin.settings.bilibiliCookie = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Python脚本路径")
			.setDesc("设置bilibili_subtitle.py脚本的路径（可选，留空使用默认路径）")
			.addText((text) =>
				text
					.setPlaceholder("输入脚本完整路径")
					.setValue(this.plugin.settings.bilibiliScriptPath)
					.onChange(async (value) => {
						this.plugin.settings.bilibiliScriptPath = value;
						await this.plugin.saveSettings();
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
