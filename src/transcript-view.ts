import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import {
	TranscriptResponse,
	TranscriptFetcher,
	TranscriptError
} from "./fetch-transcript";
import { formatTimestamp } from "./timestampt-utils";
import { getTranscriptBlocks, highlightText } from "./render-utils";
import { TranslationService, GoogleTranslationService } from "./translation-service";
import type YTranscriptPlugin from "./main";
import { APIServiceFactory } from "./api-services";

interface VideoMetadata {
	title: string;
	url: string;
	timestamp: string;
}

interface ArchiveData {
	basic: {
		link: string;
		summary: string;
		srt: string;
	};
	advanced: {
		link: string;
		summary: string;
		srt: string;
	};
	qa?: {
		questions: string[];
		answers: string[];
	};
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

interface TranscriptBlock {
	quote: string;
	quoteTimeOffset: number;
}

interface TranscriptLine {
	text: string;
	duration: number;
	offset: number;
}

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
			// 获取所有文本内容，包括原文翻译
			const originalText = block.querySelector(".original-text")?.textContent?.toLowerCase() || "";
			const translatedText = block.querySelector(".translated-text")?.textContent?.toLowerCase() || "";
			const timestampText = block.querySelector(".timestamp")?.textContent?.toLowerCase() || "";
			const allText = `${originalText} ${translatedText} ${timestampText}`;

			if (searchValue === "") {
				// 如果搜索框为空，显示所有内容
				(block as HTMLElement).style.display = "block";
				// 移除之前的高亮
				const originalEl = block.querySelector(".original-text");
				const translatedEl = block.querySelector(".translated-text");
				if (originalEl) {
					this.removeHighlights(originalEl as HTMLElement);
				}
				if (translatedEl) {
					this.removeHighlights(translatedEl as HTMLElement);
				}
			} else if (allText.includes(searchLower)) {
				// 如果找到匹配内容，显示并高亮
				(block as HTMLElement).style.display = "block";
				const originalEl = block.querySelector(".original-text");
				const translatedEl = block.querySelector(".translated-text");
				
				if (originalEl) {
					this.highlightText(originalEl as HTMLElement, searchValue);
				}
				if (translatedEl) {
					this.highlightText(translatedEl as HTMLElement, searchValue);
				}
				hasResults = true;
			} else {
				// 如果没有匹配内容，保持显示但不高亮
				(block as HTMLElement).style.display = "block";
				const originalEl = block.querySelector(".original-text");
				const translatedEl = block.querySelector(".translated-text");
				if (originalEl) {
					this.removeHighlights(originalEl as HTMLElement);
				}
				if (translatedEl) {
					this.removeHighlights(translatedEl as HTMLElement);
				}
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
			} else {
				// 如果未启用翻译，创建只包含原文的数组
				translations = paragraphs.map(para => ({
					original: para.text.join(' '),
					translated: ''
				}));
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
			text: "正在处理文本..."
		});

		try {
			// 如果没有启用翻译，直接返回文
			if (!this.plugin.settings.enableTranslation) {
				return paragraphs.map(para => ({
					original: para.text.join(' '),
					translated: ''
				}));
			}

			// 检查第一段文本的语言
			const firstText = paragraphs[0]?.text.join(' ');
			const isChineseContent = this.isChineseText(firstText);
			const targetLang = this.plugin.settings.targetLang;

			// 如果目标语言是中文且内容已经是中文，则不需要翻译
			if (targetLang.toLowerCase().includes('zh') && isChineseContent) {
				return paragraphs.map(para => ({
					original: para.text.join(' '),
					translated: ''
				}));
			}

			// 如果内容是中文但目标语言不是中文，或者内容不是中文但目标语言是中文，则进行翻译
			return await Promise.all(
				paragraphs.map(async para => {
					try {
						const originalText = para.text.join(' ');
						const translation = await this.translationService.translate(
							originalText,
							targetLang
						);
						return {
							original: originalText,
							translated: translation
						};
					} catch (error) {
						return {
							original: para.text.join(' '),
							translated: ''  // 翻译失败时不显示错误信息
						};
					}
				})
			);
		} catch (error) {
			console.error('Translation error:', error);
			return paragraphs.map(para => ({
				original: para.text.join(' '),
				translated: ''
			}));
		} finally {
			loadingIndicator.remove();
		}
	}

	// 添加检测中文文本的方法
	private isChineseText(text: string): boolean {
		// 检查是否包含中文字符
		const chineseRegex = /[\u4e00-\u9fa5]/;
		// 计算中文字符的比例
		const chineseChars = text.split('').filter(char => chineseRegex.test(char));
		const chineseRatio = chineseChars.length / text.length;
		// 如果中文字符占比超过30%，认为是中文内容
		return chineseRatio > 0.3;
	}

	private async combineIntoParagraphs(transcript: TranscriptItem[], url: string): Promise<ParagraphItem[]> {
		// 句子结束的标志
		const completeEndRegex = /[.!?。！？]\s*$/;
		// 不完整句子的标
		const incompleteEndRegex = /\b(and|or|but|because|if|for|to|the|a|an|in|on|at|by|with|I'm|I|you're|he's|she's|it's|we're|they're)\s*$/i;
		// 新主题开始的标志词
		const newTopicRegex = /^(Now|However|But|Therefore|Moreover|Furthermore|In addition|First|Second|Third|Finally|Also|Besides|Meanwhile|Later|Then)\b/i;
		// 移除多余空格的函数
		const normalizeSpaces = (text: string) => text.replace(/\s+/g, ' ').trim();

		// 如果启用了 AI 优化且有可的 API
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

				// 将优化后文本分割成句子
				const sentences = optimizedText.split(/(?<=[.!?。！？])\s+/);
				
				return this.createParagraphsFromSentences(sentences, transcript, url);
			} catch (error) {
				console.error("AI优化失败:", error);
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

			// 判断否应该前落
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
			startTime: number;
			endTime: number;
		} = {
			texts: [],
			startTime: 0,
			endTime: 0
		};

		// 句子结束的标点符号
		const sentenceEndRegex = /[.!?。！？]\s*$/;
		// 段落结束的标志（比如说话人的改变、主题的改变等）
		const paragraphEndRegex = /^(But |However |Now |So |And |In |On |At |The |This |That |These |Those |I |We |You |He |She |It |They )/i;

		transcript.forEach((item, index) => {
			const text = item.text.trim();
			const timestamp = item.timestamp || 0;

			// 果是第一目初始化开始时间
			if (currentParagraph.texts.length === 0) {
				currentParagraph.startTime = timestamp;
			}

			// 添加当前文本到当前段落
			currentParagraph.texts.push(text);
			currentParagraph.endTime = timestamp;

			// 判断是否应该结束当前段落
			const isLastItem = index === transcript.length - 1;
			const endsWithPunctuation = sentenceEndRegex.test(text);
			const nextItemStartsNewParagraph = !isLastItem && 
				paragraphEndRegex.test(transcript[index + 1].text);

			if (isLastItem || (endsWithPunctuation && nextItemStartsNewParagraph)) {
				// 结束当前段落
				paragraphs.push({
					text: currentParagraph.texts,
					timestamp: currentParagraph.startTime,
					endTimestamp: currentParagraph.endTime,
					timeLinks: [`[${formatTimestamp(currentParagraph.startTime)}-${formatTimestamp(currentParagraph.endTime)}](${url}&t=${Math.floor(currentParagraph.startTime/1000)})`]
				});

				// 重置当前段落
				currentParagraph = {
					texts: [],
					startTime: 0,
					endTime: 0
				};
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
		// 检查是否是中文内容
		const isChineseContent = this.isChineseText(translations[0]?.original || '');
		const targetLang = this.plugin.settings.targetLang;
		const skipTranslation = targetLang.toLowerCase().includes('zh') && isChineseContent;

		
		paragraphs.forEach((para, index) => {
			const blockDiv = container.createEl("div", {
				cls: "transcript-block"
			});
			
			// 创建时间戳容器
			const timeDiv = blockDiv.createEl("div", {
				cls: "timestamp-container"
			});

			// 显示时间段
			const timeRange = timeDiv.createEl("a", {
				cls: "timestamp-link",
				href: `${url}&t=${Math.floor(para.timestamp/1000)}`,
				text: `[${formatTimestamp(para.timestamp)}-${formatTimestamp(para.endTimestamp || para.timestamp)}]`
			});
			timeRange.setAttr("target", "_blank");
			
			// 创建内容容器
			const contentDiv = blockDiv.createEl("div", {
				cls: "content-container"
			});
			
			// 原文
			const originalDiv = contentDiv.createEl("div", {
				cls: "original-text"
			});
			
			// 合并段落中的所有文本
			const formattedOriginalText = para.text.join(' ').replace(/\n+/g, ' ').trim();
			originalDiv.createSpan({
				text: formattedOriginalText
			});
			
			// 只有在需要显示翻译时才添加分隔线和翻译文本
			if (!skipTranslation && translations[index].translated) {
				// 分隔线
				contentDiv.createEl("div", {
					cls: "translation-divider"
				});
				
				// 译文
				const translatedDiv = contentDiv.createEl("div", {
					cls: 'translated-text'
				});
				
				const formattedTranslatedText = translations[index].translated.replace(/\n+/g, ' ').trim();
				translatedDiv.createSpan({
					text: formattedTranslatedText
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
					const text = (para as any).lines.map((line: { offset: number; text: string }) => 
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
			// 添加 URL 入框
			this.renderUrlInput(url);

			if (this.loaderContainerEl === undefined) {
				this.loaderContainerEl = this.contentEl.createEl("div");
			} else {
				this.loaderContainerEl.empty();
			}

			this.renderLoader();

			let data;
			// 使用 TranscriptFetcher 来获取字幕
			data = await TranscriptFetcher.fetchTranscript(url, {
				lang,
				country,
				useAI: this.plugin.settings.useAIOptimization
			});

			if (!data) throw Error();

			// 保存数据到类属性中
			this.videoData = [data];
			this.videoTitle = data.title;

			this.isDataLoaded = true;
			this.loaderContainerEl.empty();

			this.renderVideoTitle(data.title);
			this.renderSearchInput(url, data, timestampMod);
			
			// 添加保存按钮
			await this.renderSaveButton();

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
				await this.renderTranscriptionBlocks(url, data, timestampMod, "");
			}
		} catch (err: unknown) {
			let errorMessage = "";
			if (err instanceof TranscriptError) {
				errorMessage = err.message;
			} else if (err instanceof Error) {
				errorMessage = err.message;
			} else {
				errorMessage = "Unknown error occurred";
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
				placeholder: "输入 YouTube 或 Bilibili 视频链接...",
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

	private async renderSaveButton() {
		const buttonContainer = this.contentEl.createEl("div", {
			cls: "save-button-container"
		});

		// 添加AI优化按钮
		const aiOptimizeButton = buttonContainer.createEl("button", {
			cls: "save-button",
			text: "AI优化"
		});
		aiOptimizeButton.style.marginRight = "10px";

		// 添加AI翻译按
		const aiTranslateButton = buttonContainer.createEl("button", {
			cls: "save-button",
			text: "AI翻译"
		});
		aiTranslateButton.style.marginRight = "10px";

		// 保存按钮
		const saveButton = buttonContainer.createEl("button", {
			cls: "save-button",
			text: "保存为 Markdown"
		});

		// AI优化按钮点击事件
		aiOptimizeButton.addEventListener("click", async () => {
			aiOptimizeButton.disabled = true;
			aiOptimizeButton.textContent = "优化中...";
			try {
				await this.handleAIOptimize();
			} finally {
				aiOptimizeButton.disabled = false;
				aiOptimizeButton.textContent = "AI优化";
			}
		});

		// AI翻译按钮点击事件
		aiTranslateButton.addEventListener("click", async () => {
			aiTranslateButton.disabled = true;
			aiTranslateButton.textContent = "翻译中...";
			try {
				await this.handleAITranslate();
			} finally {
				aiTranslateButton.disabled = false;
				aiTranslateButton.textContent = "AI翻译";
			}
		});

		// 保存按钮点击事件
		saveButton.addEventListener("click", async () => {
			await this.saveAsMarkdown();
		});
	}

	private async saveAsMarkdown() {
		try {
			if (!this.videoData || !this.videoTitle) {
				new Notice("没有可保存的据");
				return;
			}

			const metadata: VideoMetadata = {
				title: this.videoTitle,
				url: this.plugin.settings.leafUrls[this.getLeafIndex()],
				timestamp: new Date().toISOString()
			};

			// 创建存档数据
			const archiveData: ArchiveData = {
				basic: {
					link: metadata.url,
					summary: "",  // 可以后续添加摘要生成功能
					srt: this.generateSRT()
				},
				advanced: {
					link: metadata.url,
					summary: "",
					srt: this.generateSRT(true)  // 生成带时间戳的整字幕
				}
			};

			// 使用视频标题作为文件夹名
			const folderName = sanitizeFileName(metadata.title);
			const basePath = folderName;
			
			// 创建文件夹
			await this.app.vault.createFolder(basePath).catch(() => {});

			// 保存 JSON 文件，使用视频标题命名
			const jsonContent = JSON.stringify({
				metadata,
				archive: archiveData
			}, null, 2);
			
			await this.app.vault.create(
				`${basePath}/${folderName}.json`,
				jsonContent
			);

			// 保存 Markdown 笔记，使用视频标题命名
			const markdownContent = this.generateMarkdownContent(metadata, archiveData);
			await this.app.vault.create(
				`${basePath}/${folderName}.md`,
				markdownContent
			);

			new Notice("文件保存成功！");
		} catch (error) {
			console.error("保存失败:", error);
			new Notice("保存失败: " + error.message);
		}
	}

	private generateSRT(includeTimestamps: boolean = false): string {
		if (!this.videoData) return "";
		
		let srt = "";
		this.videoData.forEach((data, index) => {
			data.lines.forEach((line, lineIndex) => {
				if (includeTimestamps) {
					srt += `${lineIndex + 1}\n`;
					srt += `${formatTimestamp(line.offset)} --> ${formatTimestamp(line.offset + line.duration)}\n`;
				}
				srt += `${line.text}\n\n`;
			});
		});
		return srt;
	}

	private generateTranscriptMarkdown(): string {
		if (!this.videoData) return "";
		
		let markdown = "";
		const blocks = this.contentEl.querySelectorAll(".transcript-block");
		
		blocks.forEach(block => {
			// 获取时间戳
			const timestampEl = block.querySelector(".timestamp-link");
			const timestamp = timestampEl?.textContent || "";
			const timestampHref = timestampEl?.getAttribute("href") || "";
			
			// 获原文
			const originalText = block.querySelector(".original-text")?.textContent?.trim() || "";
			
			// 获取翻译（如果存在）
			const translatedText = block.querySelector(".translated-text")?.textContent?.trim();
			
			// 组合 Markdown
			markdown += `[${timestamp}](${timestampHref})\n\n`;
			markdown += `${originalText}\n\n`;
			
			if (translatedText) {
				markdown += `译文：${translatedText}\n\n`;
			}
			
			markdown += `---\n\n`; // 添加分隔线
		});
		
		return markdown;
	}

	private generateMarkdownContent(metadata: VideoMetadata, archiveData: ArchiveData): string {
		let markdown = `# ${metadata.title}

## 视频信息
- 标题：${metadata.title}
- 链接：${metadata.url}
- 保存时间：${new Date(metadata.timestamp).toLocaleString()}

## 字幕内容\n\n`;

		// 获取所有字幕块
		const blocks = this.contentEl.querySelectorAll(".transcript-block");
		
		// 创建字幕内容
		let transcriptContent = "";
		
		blocks.forEach(block => {
			// 获取时间戳
			const timestampEl = block.querySelector(".timestamp-link");
			const timestamp = timestampEl?.textContent || "";
			const timestampHref = timestampEl?.getAttribute("href") || "";
			
			// 获取原文
			const originalTextEl = block.querySelector(".original-text");
			const originalText = originalTextEl?.textContent?.trim() || "";
			
			// 获取翻译文本（如果存在）
			const translatedTextEl = block.querySelector(".translated-text");
			const translatedText = translatedTextEl?.textContent?.trim() || "";
			
			// 添加时间戳和原文
			transcriptContent += `${timestamp} ${originalText}\n\n`;
			
			// 如果有翻译且不是错误信息，添加翻译
			if (translatedText && !translatedText.includes('翻译失败')) {
				transcriptContent += `${translatedText}\n\n`;
			}
			
			// 添加分隔线
			transcriptContent += `---\n\n`;
		});

		markdown += transcriptContent;
		
		markdown += `
## 笔记
<!-- 在此处添加笔记 -->

## 问答
<!-- 在此处添加问答内容 -->
`;

		return markdown;
	}

	private async handleAITranslate() {
		// 检查是否选择了 AI 服务
		if (!this.plugin.settings.selectedAIService) {
			new Notice("请先在设置中选择 AI 服务");
			return;
		}

		const apiService = APIServiceFactory.getService(this.plugin.settings);
		if (!apiService) {
			new Notice(`请先在设置中配置 ${this.plugin.settings.selectedAIService === 'kimi' ? 'Kimi' : 'DeepSeek'} API密钥`);
			return;
		}

		try {
			const blocks = this.dataContainerEl?.querySelectorAll('.transcript-block');
			if (!blocks) return;

			const loadingIndicator = this.contentEl.createEl("div", {
				cls: "translation-loading",
				text: "正在使用AI进行翻译..."
			});

			const blockArray = Array.from(blocks);

			for (const block of blockArray) {
				const originalText = block.querySelector('.original-text')?.textContent;
				if (!originalText) continue;

				try {
					// 创建或获取翻译文本元素
					let translatedDiv = block.querySelector('.translated-text');
					const contentDiv = block.querySelector('.content-container');
					if (!contentDiv) continue;

					if (!translatedDiv) {
						if (!contentDiv.querySelector('.translation-divider')) {
							contentDiv.createEl("div", { cls: "translation-divider" });
						}
						translatedDiv = contentDiv.createEl('div', { cls: 'translated-text' });
					}

					// 使用��式输出
					await apiService.translate(
						originalText,
						this.plugin.settings.targetLang,
						(partialText: string) => {
							if (translatedDiv) {
								translatedDiv.textContent = partialText;
							}
						}
					);

				} catch (error) {
					console.error('翻译失败:', error);
					let translatedDiv = block.querySelector('.translated-text');
					if (!translatedDiv) {
						const contentDiv = block.querySelector('.content-container');
						if (!contentDiv) continue;
						
						if (!contentDiv.querySelector('.translation-divider')) {
							contentDiv.createEl("div", { cls: "translation-divider" });
						}
						
						translatedDiv = contentDiv.createEl('div', { cls: 'translation-error' });
					}
					translatedDiv.textContent = '翻译失败: ' + error.message;
				}
			}

			loadingIndicator.remove();
			new Notice("AI翻译完成");
		} catch (error) {
			new Notice("AI翻译失败: " + error.message);
		}
	}

	private async handleAIOptimize() {
		// 检查是否选择了 AI 服务
		if (!this.plugin.settings.selectedAIService) {
			new Notice("请先在设置中选择 AI 服务");
			return;
		}

		const apiService = APIServiceFactory.getService(this.plugin.settings);
		if (!apiService) {
			new Notice(`请先在设置中配置 ${this.plugin.settings.selectedAIService === 'kimi' ? 'Kimi' : 'DeepSeek'} API密钥`);
			return;
		}

		try {
			const blocks = this.dataContainerEl?.querySelectorAll('.transcript-block');
			if (!blocks) return;

			const loadingIndicator = this.contentEl.createEl("div", {
				cls: "translation-loading",
				text: "正在使用AI进行优化..."
			});

			const blockArray = Array.from(blocks);

			for (const block of blockArray) {
				const originalTextEl = block.querySelector('.original-text');
				if (!originalTextEl || !originalTextEl.textContent) continue;

				try {
					// 使用流式输出
					await apiService.optimize(
						originalTextEl.textContent,
						(partialText: string) => {
							originalTextEl.textContent = partialText;
						}
					);
				} catch (error) {
					console.error('优化失败:', error);
					new Notice(`部分内容优化失败: ${error.message}`);
				}
			}

			loadingIndicator.remove();
			new Notice("AI优化完成");
		} catch (error) {
			new Notice("AI优化失败: " + error.message);
		}
	}
}

// 辅助函数：文件名清理（增强版）
function sanitizeFileName(name: string): string {
	// 移除或替换不合法的文件名字符
	const sanitized = name
		.replace(/[\\/:*?"<>|]/g, '_')  // 替换 Windows 不允许的字符
		.replace(/\s+/g, '_')           // 替换空格为下划线
		.replace(/_{2,}/g, '_')         // 将多个连续下划线替换为单个
		.replace(/^_+|_+$/g, '')        // 移除首尾的下划线
		.trim();
	
	// 如果文件名过长，截取合适长度（保留最后的扩展名）
	const MAX_LENGTH = 100;  // 设置最大长度
	if (sanitized.length > MAX_LENGTH) {
		return sanitized.substring(0, MAX_LENGTH);
	}
	
	return sanitized;
}
