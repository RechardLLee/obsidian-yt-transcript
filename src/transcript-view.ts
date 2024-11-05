import YTranscriptPlugin from "./main";
import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import {
	TranscriptResponse,
	YoutubeTranscript,
	YoutubeTranscriptError,
} from "./fetch-transcript";
import { formatTimestamp } from "./timestampt-utils";
import { getTranscriptBlocks, highlightText } from "./render-utils";
import { TranscriptBlock } from "./types";
import { TranslationService, GoogleTranslationService } from "./translation-service";

export interface TranscriptLine {
	text: string;
	offset: number;
	duration: number;
}

export interface TranscriptItem {
	text: string;
	timestamp?: number;
}

export interface ParagraphItem {
	text: string[];
	timestamp: number;
	endTimestamp?: number;
	timeLinks: string[];
}

export const TRANSCRIPT_TYPE_VIEW = "transcript-view";
export class TranscriptView extends ItemView {
	isDataLoaded: boolean;
	plugin: YTranscriptPlugin;

	loaderContainerEl?: HTMLElement;
	dataContainerEl?: HTMLElement;
	errorContainerEl?: HTMLElement;

	videoTitle?: string;
	videoData?: TranscriptResponse[] = [];

	private translationService: TranslationService;

	constructor(leaf: WorkspaceLeaf, plugin: YTranscriptPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.isDataLoaded = false;
		this.translationService = new GoogleTranslationService();
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h4", { text: "Transcript" });
	}

	async onClose() {
		const leafIndex = this.getLeafIndex();
		this.plugin.settings.leafUrls.splice(leafIndex, 1);
	}

	/**
	 * Gets the leaf index out of all of the open leaves
	 * This assumes that the leaf order shouldn't changed, which is a fair assumption
	 */
	private getLeafIndex(): number {
		const leaves = this.app.workspace.getLeavesOfType(TRANSCRIPT_TYPE_VIEW);
		return leaves.findIndex((leaf) => leaf === this.leaf);
	}

	/**
	 * Adds a div with loading text to the view content
	 */
	private renderLoader() {
		if (this.loaderContainerEl !== undefined) {
			this.loaderContainerEl.createEl("div", {
				text: "Loading...",
			});
		}
	}

	/**
	 * Adds a text input to the view content
	 */
	private renderSearchInput(
		url: string,
		data: TranscriptResponse,
		timestampMod: number,
	) {
		const searchInputEl = this.contentEl.createEl("input");
		searchInputEl.type = "text";
		searchInputEl.placeholder = "Search...";
		searchInputEl.style.marginBottom = "20px";
		searchInputEl.addEventListener("input", (e) => {
			const searchFilter = (e.target as HTMLInputElement).value;
			this.renderTranscriptionBlocks(
				url,
				data,
				timestampMod,
				searchFilter,
			);
		});
	}

	/**
	 * Adds a div with the video title to the view content
	 * @param title - the title of the video
	 */
	private renderVideoTitle(title: string) {
		const titleEl = this.contentEl.createEl("div");
		titleEl.innerHTML = title;
		titleEl.style.fontWeight = "bold";
		titleEl.style.marginBottom = "20px";
	}

	private formatContentToPaste(url: string, blocks: TranscriptBlock[]) {
		return blocks
			.map((block) => {
				const { quote, quoteTimeOffset } = block;
				const href = url + "&t=" + Math.floor(quoteTimeOffset / 1000);
				const formattedBlock = `[${formatTimestamp(
					quoteTimeOffset,
				)}](${href}) ${quote}`;

				return formattedBlock;
			})
			.join("\n");
	}

	/**
	 * Add a transcription blocks to the view content
	 * @param url - the url of the video
	 * @param data - the transcript data
	 * @param timestampMod - the number of seconds between each timestamp
	 * @param searchValue - the value to search for in the transcript
	 */
	private async renderTranscriptionBlocks(
		url: string,
		data: TranscriptResponse,
		timestampMod: number,
		searchValue: string,
	) {
		const dataContainerEl = this.dataContainerEl;
		if (!dataContainerEl) return;
		
		dataContainerEl.empty();

		// 使用新的段落合并逻辑
		const paragraphs = this.combineIntoParagraphs(data.lines.map(line => ({
			text: line.text,
			timestamp: line.offset
		})), url);

		// 获取翻译
		let translations: string[] = [];
		if (this.plugin.settings.enableTranslation) {
			translations = await this.getTranslations(paragraphs);
		}

		// 渲染内容
		this.renderParagraphs(paragraphs, translations, url, dataContainerEl);

		// 处理搜索高亮
		if (searchValue) {
			this.handleSearchHighlight(dataContainerEl, searchValue);
		}
	}

	private async getTranslations(paragraphs: ParagraphItem[]): Promise<string[]> {
		const loadingIndicator = this.contentEl.createEl("div", {
			cls: "translation-loading",
			text: "正在加载翻译..."
		});

		try {
			const translations = await Promise.all(
				paragraphs.map(async para => {
					try {
						const fullText = para.text.join(' ');
						return await this.translationService.translate(
							fullText,
							this.plugin.settings.targetLang
						);
					} catch (error) {
						console.error("Translation failed for text:", para.text, error);
						return `翻译失败: ${error?.message || '未知错误'}`;
					}
				})
			);
			return translations;
		} finally {
			loadingIndicator.remove();
		}
	}

	private combineIntoParagraphs(transcript: TranscriptItem[], url: string): ParagraphItem[] {
		const paragraphs: ParagraphItem[] = [];
		let currentParagraph: {
			texts: string[];
			timestamps: number[];
			firstTimestamp: number;
		} = {
			texts: [],
			timestamps: [],
			firstTimestamp: 0
		};
		
		const sentenceEndRegex = /[.!?。！？]\s*$/;
		
		transcript.forEach((item, index) => {
			currentParagraph.texts.push(item.text);
			if (item.timestamp) {
				if (currentParagraph.timestamps.length === 0) {
					currentParagraph.firstTimestamp = item.timestamp;
				}
				currentParagraph.timestamps.push(item.timestamp);
			}
			
			const shouldEndParagraph = 
				(sentenceEndRegex.test(item.text) && currentParagraph.texts.length >= 3) ||
				currentParagraph.texts.length >= 5 ||
				index === transcript.length - 1;
			
			if (shouldEndParagraph && currentParagraph.texts.length > 0) {
				paragraphs.push({
					text: currentParagraph.texts,
					timestamp: currentParagraph.firstTimestamp,
					endTimestamp: currentParagraph.timestamps[currentParagraph.timestamps.length - 1],
					timeLinks: currentParagraph.timestamps.map(ts => 
						`[${formatTimestamp(ts)}](${url}&t=${Math.floor(ts/1000)})`)
				});
				
				currentParagraph = {
					texts: [],
					timestamps: [],
					firstTimestamp: 0
				};
			}
		});
		
		return paragraphs;
	}

	private renderParagraphs(
		paragraphs: ParagraphItem[], 
		translations: string[], 
		url: string,
		container: HTMLElement
	) {
		paragraphs.forEach((para, index) => {
			const blockDiv = container.createEl("div", {
				cls: "transcript-block"
			});
			
			// 时间戳范围
			blockDiv.createEl("div", {
				cls: "timestamp",
				text: `${formatTimestamp(para.timestamp)} - ${formatTimestamp(para.endTimestamp || para.timestamp)}`
			});
			
			// 原文
			const originalDiv = blockDiv.createEl("div", {
				cls: "original-text",
				text: para.text.join(' ')
			});
			
			// 译文
			if (translations[index]) {
				blockDiv.createEl("div", {
					cls: translations[index].includes('翻译失败') ? 'translation-error' : 'translated-text',
					text: translations[index]
				});
			}

			// 添加交互功能
			this.addInteractiveFeatures(blockDiv, url, para);
		});
	}

	private handleSearchHighlight(container: HTMLElement, searchValue: string) {
		const elements = container.querySelectorAll(".transcript-line");
		elements.forEach(el => {
			if (el.textContent?.toLowerCase().includes(searchValue.toLowerCase())) {
				highlightText(el as HTMLElement, searchValue);
			}
		});
	}

	private addInteractiveFeatures(blockDiv: HTMLElement, url: string, para: any) {
		blockDiv.draggable = true;
		
		blockDiv.addEventListener("click", () => {
			navigator.clipboard.writeText(blockDiv.textContent || "");
		});

		blockDiv.addEventListener("dragstart", (event: DragEvent) => {
			event.dataTransfer?.setData("text/html", blockDiv.innerHTML);
		});

		blockDiv.addEventListener("contextmenu", (event: MouseEvent) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle("Copy all").onClick(() => {
					const text = para.lines.map((line: TranscriptLine) => 
						`[${formatTimestamp(line.offset)}](${url}&t=${Math.floor(line.offset/1000)}) ${line.text}`
					).join('\n');
					navigator.clipboard.writeText(text);
				})
			);
			menu.showAtPosition({
				x: event.clientX,
				y: event.clientY
			});
		});
	}

	/**
	 * Sets the state of the view
	 * This is called when the view is loaded
	 */
	async setEphemeralState(state: { url: string }): Promise<void> {
		if (this.isDataLoaded) return;

		const leafIndex = this.getLeafIndex();

		if (state.url) {
			this.plugin.settings.leafUrls[leafIndex] = state.url;
			await this.plugin.saveSettings();
		}

		const { lang, country, timestampMod, leafUrls } = this.plugin.settings;
		const url = leafUrls[leafIndex];

		try {
			if (this.loaderContainerEl === undefined) {
				this.loaderContainerEl = this.contentEl.createEl("div");
			} else {
				this.loaderContainerEl.empty();
			}

			this.renderLoader();

			const data = await YoutubeTranscript.fetchTranscript(url, {
				lang,
				country,
			});

			if (!data) throw Error();

			this.isDataLoaded = true;
			this.loaderContainerEl.empty();

			this.renderVideoTitle(data.title);
			this.renderSearchInput(url, data, timestampMod);

			if (this.dataContainerEl === undefined) {
				this.dataContainerEl = this.contentEl.createEl("div");
			} else {
				this.dataContainerEl.empty();
			}

			if (this.errorContainerEl !== undefined) {
				this.errorContainerEl.empty();
			}

			if (data.lines.length === 0) {
				this.dataContainerEl.createEl("h4", {
					text: "No transcript found",
				});
				this.dataContainerEl.createEl("div", {
					text: "Please check if video contains any transcript or try adjust language and country in plugin settings.",
				});
			} else {
				const transcriptItems: TranscriptItem[] = data.lines.map(line => ({
					text: line.text,
					timestamp: line.offset
				}));
				await this.renderTranscript(transcriptItems, url);
				
				this.renderTranscriptionBlocks(url, data, timestampMod, "");
			}
		} catch (err: unknown) {
			let errorMessage = "";
			if (err instanceof YoutubeTranscriptError) {
				errorMessage = err.message;
			}

			this.loaderContainerEl?.empty();

			if (this.errorContainerEl === undefined) {
				this.errorContainerEl = this.contentEl.createEl("h5");
			} else {
				this.errorContainerEl.empty();
			}
			const titleEl = this.errorContainerEl.createEl("div", {
				text: "Error loading transcript",
			});
			titleEl.style.marginBottom = "5px";

			const messageEl = this.errorContainerEl.createEl("div", {
				text: errorMessage,
			});
			messageEl.style.color = "var(--text-muted)";
			messageEl.style.fontSize = "var(--font-ui-small)";
		}
	}

	getViewType(): string {
		return TRANSCRIPT_TYPE_VIEW;
	}
	getDisplayText(): string {
		return "YouTube Transcript";
	}
	getIcon(): string {
		return "scroll";
	}

	async renderTranscript(transcript: TranscriptItem[], url: string) {
		try {
			const container = this.contentEl.createEl("div");
			
			// 使用新的段落合并逻辑
			const paragraphs = this.combineIntoParagraphs(transcript, url);
			
			if (this.plugin.settings.enableTranslation) {
				const loadingIndicator = container.createEl("div", {
					cls: "translation-loading",
					text: "正在加载翻译..."
				});
				
				// 获取翻译
				const translations = await Promise.all(
					paragraphs.map(async para => {
						try {
							// 将段落中的所有句子合并成一个完整的段落
							const fullText = para.text.join(' ');
							return await this.translationService.translate(
								fullText,
								this.plugin.settings.targetLang
							);
						} catch (error) {
							console.error("Translation failed for text:", para.text, error);
							return `翻译失败: ${error?.message || '未知错误'}`;
						}
					})
				);
				
				loadingIndicator.remove();
				
				// 渲染段落
				paragraphs.forEach((para, index) => {
					const blockDiv = container.createEl("div", {
						cls: "transcript-block"
					});
					
					// 添加时间戳范围
					blockDiv.createEl("div", {
						cls: "timestamp",
						text: `${formatTimestamp(para.timestamp)} - ${formatTimestamp(para.endTimestamp || para.timestamp)}`
					});
					
					// 原文
					const originalDiv = blockDiv.createEl("div", {
						cls: "original-text",
						text: para.text.join(' ')
					});
					
					// 译文
					blockDiv.createEl("div", {
						cls: translations[index].includes('翻译失败') ? 'translation-error' : 'translated-text',
						text: translations[index]
					});
				});
			} else {
				// 未启用翻译时的显示逻辑...
				paragraphs.forEach(para => {
					const blockDiv = container.createEl("div", {
						cls: "transcript-block"
					});
					
					blockDiv.createEl("div", {
						cls: "timestamp",
						text: `${formatTimestamp(para.timestamp)} - ${formatTimestamp(para.endTimestamp || para.timestamp)}`
					});
					
					blockDiv.createEl("div", {
						cls: "original-text",
						text: para.text.join(' ')
					});
				});
			}
		} catch (error: any) {
			const errorDiv = this.contentEl.createEl("div", {
				cls: "transcript-error",
				text: `加载失败: ${error?.message || '未知错误'}`
			});
		}
	}
}
