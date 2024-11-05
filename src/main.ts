import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { TranscriptView, TRANSCRIPT_TYPE_VIEW } from "src/transcript-view";
import { PromptModal } from "src/prompt-modal";
import { EditorExtensions } from "../editor-extensions";

interface YTranscriptSettings {
	timestampMod: number;
	lang: string;
	country: string;
	leafUrls: string[];
	enableTranslation: boolean;
	targetLang: string;
}

const DEFAULT_SETTINGS: YTranscriptSettings = {
	timestampMod: 5,
	lang: "en",
	country: "EN",
	leafUrls: [],
	enableTranslation: false,
	targetLang: "zh-CN",
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
	values: Record<string, string>;

	constructor(app: App, plugin: YTranscriptPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Settings for YTranscript" });

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
			.addText((text) =>
				text
					.setValue(this.plugin.settings.targetLang)
					.onChange(async (value) => {
						this.plugin.settings.targetLang = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
