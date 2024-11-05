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
				name: "Get YouTube transcript from selected url",
				editorCallback: (editor: Editor, _: MarkdownView) => {
					const url = EditorExtensions.getSelectedText(editor).trim();
					this.openView(url);
				},
			});

			this.addCommand({
				id: "transcript-from-prompt",
				name: "Get YouTube transcript from url prompt",
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
		containerEl.createEl("h2", { text: "Basic Settings" });

		new Setting(containerEl)
			.setName("Timestamp interval")
			.setDesc(
				"Indicates how often timestamp should occur in text (1 - every line, 10 - every 10 lines)",
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
			.setName("Language")
			.setDesc("Preferred transcript language")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.lang)
					.onChange(async (value) => {
						this.plugin.settings.lang = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Country")
			.setDesc("Preferred transcript country code")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.country)
					.onChange(async (value) => {
						this.plugin.settings.country = value;
						await this.plugin.saveSettings();
					}),
			);

		// 翻译设置
		containerEl.createEl("h2", { text: "Translation Settings" });
		containerEl.createEl("p", { 
			text: "Configure translation settings and API keys",
			cls: "setting-item-description"
		});

		new Setting(containerEl)
			.setName("Enable Translation")
			.setDesc("Enable dual language translation")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableTranslation)
					.onChange(async (value) => {
						this.plugin.settings.enableTranslation = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Target Language")
			.setDesc("Translation target language (e.g. zh-CN, ja, ko)")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("zh-CN", "Chinese (Simplified)")
					.addOption("zh-TW", "Chinese (Traditional)")
					.addOption("ja", "Japanese")
					.addOption("ko", "Korean")
					.addOption("fr", "French")
					.addOption("de", "German")
					.addOption("es", "Spanish")
					.setValue(this.plugin.settings.targetLang)
					.onChange(async (value) => {
						this.plugin.settings.targetLang = value;
						await this.plugin.saveSettings();
					})
			);

		// AI 翻译设置
		containerEl.createEl("h3", { text: "AI Translation" });

		new Setting(containerEl)
			.setName("Use AI Translation")
			.setDesc("Use Kimi AI for better translation quality")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useAITranslation)
					.onChange(async (value) => {
						this.plugin.settings.useAITranslation = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Kimi API URL")
			.setDesc("API endpoint for Kimi AI service")
			.addText((text) =>
				text
					.setPlaceholder("Enter API URL")
					.setValue(this.plugin.settings.kimiApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiUrl = value;
						await this.plugin.saveSettings();
					})
			);

		const apiKeyDesc = containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "To use AI translation, you need to provide a Kimi API key. You can get one from the Kimi website."
		});

		const apiKeyLink = apiKeyDesc.createEl("a", {
			text: "Get API Key",
			href: "https://moonshot.cn/"
		});
		apiKeyLink.setAttr("target", "_blank");

		new Setting(containerEl)
			.setName("Kimi API Key")
			.setDesc("API key for Kimi AI translation service")
			.addText((text) =>
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.kimiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.kimiApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// 添加测试按钮
		new Setting(containerEl)
			.setName("Test API Connection")
			.setDesc("Test if your API settings are working")
			.addButton((button) => 
				button
					.setButtonText("Test")
					.onClick(async () => {
						const { kimiApiKey, kimiApiUrl } = this.plugin.settings;
						if (!kimiApiKey || !kimiApiUrl) {
							new Notice("Please enter both API key and API URL");
							return;
						}

						button.setButtonText("Testing...");
						button.setDisabled(true);

						try {
							const translator = new KimiTranslationService(kimiApiKey, kimiApiUrl);
							await translator.translate("Hello, this is a test.", "zh-CN");
							new Notice("API connection successful!");
						} catch (error) {
							new Notice("API test failed: " + error.message);
						} finally {
							button.setButtonText("Test");
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
