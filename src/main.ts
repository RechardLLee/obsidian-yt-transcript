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
	useAIOptimization: boolean;
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

		// Kimi AI 设置
		containerEl.createEl("h2", { text: "Kimi AI 设置" });
		
		new Setting(containerEl)
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

		new Setting(containerEl)
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

		// DeepSeek AI 设置
		containerEl.createEl("h2", { text: "DeepSeek AI 设置" });

		new Setting(containerEl)
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

		new Setting(containerEl)
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
