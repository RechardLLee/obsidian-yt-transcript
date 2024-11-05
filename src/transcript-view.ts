import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import {
	TranscriptResponse,
	YoutubeTranscript,
	YoutubeTranscriptError,
} from "./fetch-transcript";
import { formatTimestamp } from "./timestampt-utils";
import { getTranscriptBlocks, highlightText } from "./render-utils";
import { TranslationService, GoogleTranslationService } from "./translation-service";
import type YTranscriptPlugin from "./main";

interface TranscriptBlock {
	quote: string;
	quoteTimeOffset: number;
}

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
		const searchContainer = this.contentEl.createEl("div", {
			cls: "search-container"
		});

		const searchInputEl = searchContainer.createEl("input", {
			cls: "search-input",
			attr: {
				type: "text",
				placeholder: "搜索字幕内容...",
			}
		});
		searchInputEl.style.width = "100%";
		searchInputEl.style.marginBottom = "20px";
		searchInputEl.style.padding = "8px";

		// 添加防抖
		let debounceTimeout: NodeJS.Timeout;
		searchInputEl.addEventListener("input", (e) => {
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(() => {
				const searchFilter = (e.target as HTMLInputElement).value.toLowerCase();
				this.handleSearch(searchFilter);
			}, 300);
		});
	}

	private handleSearch(searchValue: string) {
		const blocks = this.contentEl.querySelectorAll(".transcript-block");
		let hasResults = false;
		const searchLower = searchValue.toLowerCase().trim();

		blocks.forEach((block) => {
			// 获取所有文本内容，包括原文和翻译
			const originalText = block.querySelector(".original-text")?.textContent?.toLowerCase() || "";
			const translatedText = block.querySelector(".translated-text")?.textContent?.toLowerCase() || "";
			const timestampText = block.querySelector(".timestamp")?.textContent?.toLowerCase() || "";
			const allText = `${originalText} ${translatedText} ${timestampText}`;

			if (searchValue === "" || allText.includes(searchLower)) {
				(block as HTMLElement).style.display = "block";
				if (searchValue) {
					// 分别高亮原文和翻译中的匹配内容
					const originalEl = block.querySelector(".original-text");
					const translatedEl = block.querySelector(".translated-text");
					
					if (originalEl) {
						this.highlightText(originalEl as HTMLElement, searchValue);
					}
					if (translatedEl) {
						this.highlightText(translatedEl as HTMLElement, searchValue);
					}
				}
				hasResults = true;
			} else {
				(block as HTMLElement).style.display = "none";
			}
		});

		// 更新搜索状态显示
		const existingStatus = this.contentEl.querySelector(".search-status");
		if (existingStatus) {
				existingStatus.remove();
		}

		if (searchValue) {
			const statusEl = this.contentEl.createEl("div", {
				cls: "search-status",
				text: hasResults ? 
					`找到包含 "${searchValue}" 的内容` : 
					`未找到包含 "${searchValue}" 的内容`
			});
			this.contentEl.insertBefore(statusEl, this.contentEl.firstChild);
			statusEl.style.color = hasResults ? "var(--text-muted)" : "var(--text-error)";
		}
	}

	private highlightText(element: HTMLElement, searchText: string) {
		if (!searchText) return;
		
		// 保存原始内容
		const originalContent = element.textContent || "";
		// 创建临时容器
		const tempDiv = document.createElement('div');
		
		// 使用正则表达式进行不区分大小写的全局匹配
		const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		const highlightedContent = originalContent.replace(regex, '<span class="search-highlight">$1</span>');
		
		// 设置高亮后的内容
		tempDiv.innerHTML = highlightedContent;
		
		// 清空原始元素并添加高亮后的内容
		element.innerHTML = tempDiv.innerHTML;
	}

	private removeHighlights(element: HTMLElement) {
		const highlights = element.querySelectorAll('.search-highlight');
		highlights.forEach(highlight => {
			const text = highlight.textContent || '';
			highlight.replaceWith(text);
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

		try {
			// 使用 await 等待段落合并完成
			const paragraphs = await this.combineIntoParagraphs(data.lines.map(line => ({
				text: line.text,
				timestamp: line.offset
			})), url);

			// 获取翻译
			let translations: { original: string, translated: string }[] = [];
			if (this.plugin.settings.enableTranslation) {
				translations = await this.getTranslations(paragraphs);
			}

			// 渲染内容
			this.renderParagraphs(paragraphs, translations, url, dataContainerEl);

			// 处理搜索高亮
			if (searchValue) {
				this.handleSearchHighlight(dataContainerEl, searchValue);
			}
		} catch (error) {
			console.error("Error in renderTranscriptionBlocks:", error);
			const errorDiv = dataContainerEl.createEl("div", {
				cls: "transcript-error",
				text: `处理失败: ${error?.message || '未知错误'}`
			});
		}
	}

	private async getTranslations(paragraphs: ParagraphItem[]): Promise<{ original: string, translated: string }[]> {
		const loadingIndicator = this.contentEl.createEl("div", {
			cls: "translation-loading",
			text: "正在优化和翻译文本..."
		});

		try {
			if (this.plugin.settings.useDeepseek && this.plugin.settings.deepseekApiKey) {
				const { DeepseekTranslationService } = await import("./deepseek-translation-service");
				const deepseekTranslator = new DeepseekTranslationService(
					this.plugin.settings.deepseekApiKey,
					this.plugin.settings.deepseekApiUrl
				);

				return await Promise.all(
					paragraphs.map(async para => {
						try {
							const originalText = para.text.join(' ');
							const translation = await deepseekTranslator.translate(
								originalText,
								this.plugin.settings.targetLang
							);
							
							return {
								original: originalText,
								translated: translation
							};
						} catch (error) {
							console.error("DeepSeek translation failed:", error);
							// 如果 DeepSeek 翻译失败，回退到其他翻译服务
							return this.fallbackTranslation(para);
						}
					})
				);
			} else if (this.plugin.settings.useAITranslation && this.plugin.settings.kimiApiKey) {
				const { TextOptimizer } = await import("./text-optimizer");
				const { KimiTranslationService } = await import("./kimi-translation-service");
				
				const textOptimizer = new TextOptimizer(
					this.plugin.settings.kimiApiKey,
					this.plugin.settings.kimiApiUrl
				);
				const kimiTranslator = new KimiTranslationService(
					this.plugin.settings.kimiApiKey,
					this.plugin.settings.kimiApiUrl
				);

				return await Promise.all(
					paragraphs.map(async para => {
						try {
							const originalText = para.text.join(' ');
							const optimizedForTranslation = await textOptimizer.optimizeText(originalText);
							const translation = await kimiTranslator.translate(
								optimizedForTranslation,
								this.plugin.settings.targetLang
							);
							
							return {
								original: originalText,
								translated: translation
							};
						} catch (error) {
							console.error("AI processing failed:", error);
							const translation = await this.translationService.translate(
								para.text.join(' '),
								this.plugin.settings.targetLang
							);
							return {
								original: para.text.join(' '),
								translated: translation
							};
						}
					})
				);
			} else {
				return await Promise.all(
					paragraphs.map(async para => {
						const originalText = para.text.join(' ');
						const translation = await this.translationService.translate(
							originalText,
							this.plugin.settings.targetLang
						);
						return {
							original: originalText,
							translated: translation
						};
					})
				);
			}
		} finally {
			loadingIndicator.remove();
		}
	}

	private async fallbackTranslation(para: ParagraphItem): Promise<{ original: string, translated: string }> {
		const originalText = para.text.join(' ');
		try {
			if (this.plugin.settings.useAITranslation && this.plugin.settings.kimiApiKey) {
				const { KimiTranslationService } = await import("./kimi-translation-service");
				const kimiTranslator = new KimiTranslationService(
					this.plugin.settings.kimiApiKey,
					this.plugin.settings.kimiApiUrl
				);
				const translation = await kimiTranslator.translate(
					originalText,
					this.plugin.settings.targetLang
				);
				return { original: originalText, translated: translation };
			} else {
				const translation = await this.translationService.translate(
					originalText,
					this.plugin.settings.targetLang
				);
				return { original: originalText, translated: translation };
			}
		} catch (error) {
			console.error("Fallback translation failed:", error);
			return {
				original: originalText,
				translated: "翻译失败: 所有翻译服务都无法使用"
			};
		}
	}

	private async combineIntoParagraphs(transcript: TranscriptItem[], url: string): Promise<ParagraphItem[]> {
		// 句子结束的标志
		const completeEndRegex = /[.!?。！？]\s*$/;
		// 不完整句子的标志
		const incompleteEndRegex = /\b(and|or|but|because|if|for|to|the|a|an|in|on|at|by|with|I'm|I|you're|he's|she's|it's|we're|they're)\s*$/i;
		// 新主题开始的标志词
		const newTopicRegex = /^(Now|However|But|Therefore|Moreover|Furthermore|In addition|First|Second|Third|Finally|Also|Besides|Meanwhile|Later|Then)\b/i;
		// 移除多余空格的函数
		const normalizeSpaces = (text: string) => text.replace(/\s+/g, ' ').trim();

		// 如果启用了 AI 优化且有可用的 API
		if (this.plugin.settings.useAITranslation && this.plugin.settings.kimiApiKey) {
			try {
				const { TextOptimizer } = await import("./text-optimizer");
				const textOptimizer = new TextOptimizer(
					this.plugin.settings.kimiApiKey,
					this.plugin.settings.kimiApiUrl
				);

				// 先将所有文本合并并优化
				const fullText = transcript.map(item => item.text).join(' ');
				const optimizedText = await textOptimizer.optimizeText(fullText);

				// 将优化后的文本分割成句子
				const sentences = optimizedText.split(/(?<=[.!?。！？])\s+/);
				
				return this.createParagraphsFromSentences(sentences, transcript, url);
			} catch (error) {
				console.error("AI optimization failed:", error);
				// 如果 AI 优化失败，回退到普通的段落划分
				return this.createParagraphsDirectly(transcript, url);
			}
		} else {
			// 不使用 AI 时直接进行段落划分
			return this.createParagraphsDirectly(transcript, url);
		}
	}

	private createParagraphsFromSentences(
		sentences: string[], 
		transcript: TranscriptItem[], 
		url: string
	): ParagraphItem[] {
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

		let sentenceCount = 0;
		const MIN_SENTENCES = this.plugin.settings.minSentences;
		const MAX_SENTENCES = this.plugin.settings.maxSentences;

		sentences.forEach((sentence, index) => {
			// 获取当前句子对应的时间戳
			const timestamp = transcript[index]?.timestamp || 0;

			currentParagraph.texts.push(sentence);
			if (timestamp) {
				if (currentParagraph.timestamps.length === 0) {
					currentParagraph.firstTimestamp = timestamp;
				}
				currentParagraph.timestamps.push(timestamp);
			}
			sentenceCount++;

			// 判断否应该结束前段落
			const shouldEndParagraph = 
				(sentenceCount >= MIN_SENTENCES && sentence.match(/[.!?。！？]$/)) ||
				sentenceCount >= MAX_SENTENCES ||
				index === sentences.length - 1;

			if (shouldEndParagraph) {
				paragraphs.push({
					text: [currentParagraph.texts.join(' ')],
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
				sentenceCount = 0;
			}
		});

		return paragraphs;
	}

	private createParagraphsDirectly(transcript: TranscriptItem[], url: string): ParagraphItem[] {
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

		let sentenceCount = 0;
		const MIN_SENTENCES = this.plugin.settings.minSentences;
		const MAX_SENTENCES = this.plugin.settings.maxSentences;
		const sentenceEndRegex = /[.!?。！？]\s*$/;
		const incompleteEndRegex = /\b(and|or|but|because|if|for|to|the|a|an|in|on|at|by|with|I'm|I|you're|he's|she's|it's|we're|they're)\s*$/i;

		transcript.forEach((item, index) => {
			const text = item.text.trim();
			
			// 检查是否是完整句子
			const isCompleteSentence = sentenceEndRegex.test(text);
			const isIncomplete = incompleteEndRegex.test(text);

			currentParagraph.texts.push(text);
			if (item.timestamp) {
				if (currentParagraph.timestamps.length === 0) {
					currentParagraph.firstTimestamp = item.timestamp;
				}
				currentParagraph.timestamps.push(item.timestamp);
			}

			if (isCompleteSentence && !isIncomplete) {
				sentenceCount++;
			}

			// 判断是否应该结束当前段落
			const shouldEndParagraph = 
				(sentenceCount >= MIN_SENTENCES && isCompleteSentence) ||
				sentenceCount >= MAX_SENTENCES ||
				index === transcript.length - 1;

			if (shouldEndParagraph && !isIncomplete) {
				paragraphs.push({
					text: [currentParagraph.texts.join(' ')],
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
				sentenceCount = 0;
			}
		});

		return paragraphs;
	}

	private renderParagraphs(
		paragraphs: ParagraphItem[], 
		translations: { original: string, translated: string }[], 
		url: string,
		container: HTMLElement
	) {
		paragraphs.forEach((para, index) => {
			const blockDiv = container.createEl("div", {
				cls: "transcript-block"
			});
			
			// 创建时间戳容器
			const timeDiv = blockDiv.createEl("div", {
				cls: "timestamp-container"
			});
			
			// 添加时间戳和链接
			const timeLink = timeDiv.createEl("a", {
				cls: "timestamp-link",
				href: `${url}&t=${Math.floor(para.timestamp/1000)}`,
				text: `${formatTimestamp(para.timestamp)} - ${formatTimestamp(para.endTimestamp || para.timestamp)}`
			});
			
			timeLink.setAttr("target", "_blank");
			
			// 创建内容容器
			const contentDiv = blockDiv.createEl("div", {
				cls: "content-container"
			});
			
			// 原文
			const originalDiv = contentDiv.createEl("div", {
				cls: "original-text"
			});
			
			originalDiv.createSpan({
				text: translations[index].original
			});
			
			// 分隔线
			contentDiv.createEl("div", {
				cls: "translation-divider"
			});
			
			// 译文
			if (translations[index].translated) {
				const translatedDiv = contentDiv.createEl("div", {
					cls: translations[index].translated.includes('翻译失败') ? 'translation-error' : 'translated-text'
				});
				
				translatedDiv.createSpan({
					text: translations[index].translated
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
		const leafIndex = this.getLeafIndex();

		if (state.url) {
			this.plugin.settings.leafUrls[leafIndex] = state.url;
			await this.plugin.saveSettings();
		}

		const { lang, country, timestampMod, leafUrls } = this.plugin.settings;
		const url = leafUrls[leafIndex];

		try {
			// 添加 URL 输入框
			this.renderUrlInput(url);

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
				// 移除重复的渲染调用，只保留一个
				await this.renderTranscriptionBlocks(url, data, timestampMod, "");
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

	// 在 renderSearchInput 方法之前添加新的方法
	private renderUrlInput(currentUrl: string) {
		const urlContainer = this.contentEl.createEl("div", {
			cls: "url-input-container"
		});

		// 创建输入框容器，使用 flex 布局
		const inputWrapper = urlContainer.createEl("div", {
			cls: "url-input-wrapper"
		});
		inputWrapper.style.display = "flex";
		inputWrapper.style.gap = "10px";
		inputWrapper.style.marginBottom = "20px";

		// 创建输入框
		const urlInputEl = inputWrapper.createEl("input", {
			cls: "url-input",
			attr: {
				type: "text",
				placeholder: "输入 YouTube 视频链接...",
				value: currentUrl
			}
		});
		urlInputEl.style.flex = "1";
		urlInputEl.style.padding = "8px";

		// 创建确认按钮
		const confirmButton = inputWrapper.createEl("button", {
			cls: "url-confirm-button",
			text: "确认"
		});
		confirmButton.style.padding = "8px 16px";

		// 修改按钮点击事件处理
		confirmButton.addEventListener("click", async () => {
			const newUrl = urlInputEl.value.trim();
			if (newUrl) {
				try {
					// 清空现有内容
					this.contentEl.empty();
					this.contentEl.createEl("h4", { text: "Transcript" });
					
					// 重置状态
					this.isDataLoaded = false;
					this.dataContainerEl = undefined;
					this.loaderContainerEl = undefined;
					this.errorContainerEl = undefined;
					
					// 更新 leafUrls
					const leafIndex = this.getLeafIndex();
					this.plugin.settings.leafUrls[leafIndex] = newUrl;
					await this.plugin.saveSettings();
					
					// 重新加载新的字幕
					await this.setEphemeralState({ url: newUrl });
				} catch (error) {
					console.error("Failed to load new transcript:", error);
					new Notice("加载字幕失败，请检查链接是否正确");
				}
			}
		});

		// 修改回车键事件处理
		urlInputEl.addEventListener("keypress", async (e) => {
			if (e.key === "Enter") {
				const newUrl = urlInputEl.value.trim();
				if (newUrl) {
					try {
						this.contentEl.empty();
						this.contentEl.createEl("h4", { text: "Transcript" });
						
						// 重置状态
						this.isDataLoaded = false;
						this.dataContainerEl = undefined;
						this.loaderContainerEl = undefined;
						this.errorContainerEl = undefined;
						
						// 更新 leafUrls
						const leafIndex = this.getLeafIndex();
						this.plugin.settings.leafUrls[leafIndex] = newUrl;
						await this.plugin.saveSettings();
						
						await this.setEphemeralState({ url: newUrl });
					} catch (error) {
						console.error("Failed to load new transcript:", error);
						new Notice("加载字幕失败，请检查链接是否正确");
					}
				}
			}
		});
	}
}
