import { parse } from "node-html-parser";
import { request, requestUrl } from "obsidian";
const YOUTUBE_TITLE_REGEX = new RegExp(
	/<meta\s+name="title"\s+content="([^"]*)">/,
);

export class TranscriptError extends Error {
	constructor(err: unknown) {
		if (!(err instanceof Error)) {
			super("");
			return;
		}

		if (err.message.includes("ERR_INVALID_URL")) {
			super("Invalid URL");
		} else {
			super(err.message);
		}
	}
}

export interface TranscriptConfig {
	lang?: string;
	country?: string;
	useAI?: boolean;
}

export interface TranscriptResponse {
	title: string;
	lines: TranscriptLine[];
}

export interface TranscriptLine {
	text: string;
	duration: number;
	offset: number;
}

export class TranscriptFetcher {
	public static async fetchTranscript(
		url: string,
		config?: TranscriptConfig
	): Promise<TranscriptResponse> {
		try {
			if (url.includes('bilibili.com')) {
				const { BilibiliTranscript } = await import("./bilibili-transcript");
				return await BilibiliTranscript.fetchTranscript(url, {
					lang: config?.lang,
					useAI: config?.useAI
				});
			} else {
				return await this.fetchYoutubeTranscript(url, config);
			}
		} catch (err: any) {
			throw new TranscriptError(err);
		}
	}

	private static async fetchYoutubeTranscript(
		url: string,
		config?: TranscriptConfig
	): Promise<TranscriptResponse> {
		const hasSubtitles = await this.checkSubtitlesExist(url);
		if (!hasSubtitles) {
			throw new Error("该视频没有字幕");
		}

		const langCode = config?.lang ?? "en";

		const videoPageBody = await request(url);
		const parsedBody = parse(videoPageBody);

		const titleMatch = videoPageBody.match(YOUTUBE_TITLE_REGEX);
		let title = "";
		if (titleMatch) title = titleMatch[1];

		const scripts = parsedBody.getElementsByTagName("script");
		const playerScript = scripts.find((script) =>
			script.textContent.includes("var ytInitialPlayerResponse = {"),
		);

		const dataString =
			playerScript!.textContent
				?.split("var ytInitialPlayerResponse = ")?.[1]
				?.split("};")?.[0] + "}";

		const data = JSON.parse(dataString.trim());
		const availableCaptions =
			data?.captions?.playerCaptionsTracklistRenderer
				?.captionTracks || [];

		let captionTrack = availableCaptions?.[0];
		if (langCode)
			captionTrack =
				availableCaptions.find((track: any) =>
					track.languageCode.includes(langCode),
				) ?? availableCaptions?.[0];

		if (!captionTrack) {
			throw new Error(`未找到${langCode}语言的字幕`);
		}

		const captionsUrl = captionTrack?.baseUrl;
		const fixedCaptionsUrl = captionsUrl.startsWith("https://")
			? captionsUrl
			: "https://www.youtube.com" + captionsUrl;

		const resXML = await request(fixedCaptionsUrl).then((xml) =>
			parse(xml),
		);

		const chunks = resXML.getElementsByTagName("text");
		const lines = chunks.map((cue: any) => ({
			text: this.cleanText(cue.textContent
				.replaceAll("&#39;", "'")
				.replaceAll("&amp;", "&")
				.replaceAll("&quot;", '"')
				.replaceAll("&apos;", "'")
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">")),
			duration: parseFloat(cue.attributes.dur) * 1000,
			offset: parseFloat(cue.attributes.start) * 1000,
		}));

		const optimizedLines = config?.useAI ? lines : this.optimizeSubtitles(lines);

		return {
			title: title,
			lines: optimizedLines,
		};
	}

	private static optimizeSubtitles(subtitles: TranscriptLine[]): TranscriptLine[] {
		const mergedSubtitles = this.mergeShortSubtitles(subtitles);
		
		const cleanedSubtitles = mergedSubtitles.map(line => ({
			...line,
			text: this.cleanText(line.text)
		}));

		return cleanedSubtitles.sort((a, b) => a.offset - b.offset);
	}

	private static cleanText(text: string): string {
		// 检测是否主要是英文文本
		const englishMatches = text.match(/[a-zA-Z]/g);
		const chineseMatches = text.match(/[\u4e00-\u9fa5]/g);
		
		const isEnglish = (englishMatches?.length || 0) > (chineseMatches?.length || 0);
		
		if (isEnglish) {
			return this.cleanEnglishText(text);
		} else {
			return this.cleanChineseText(text);
		}
	}

	private static cleanEnglishText(text: string): string {
		// 1. 基础清理
		let result = text
			.replace(/\s+/g, ' ')  // 合并多个空格
			.replace(/[【】\[\]]/g, '')  // 移除方括号
			.replace(/\(.*?\)/g, '') // 移除圆括号内容
			.replace(/\{.*?\}/g, '') // 移除花括号内容
			.trim();

		// 2. 分句并重组
		const sentences = result.split(/([.!?]+)/).filter(Boolean);
		const cleanedSentences = [];
		
		for (let i = 0; i < sentences.length; i += 2) {
			let sentence = sentences[i];
			const punctuation = sentences[i + 1] || '.';
			
			// 处理每个句子
			sentence = sentence
				.trim()
				// 修复撇号
				.replace(/([a-zA-Z])'([a-zA-Z])/g, "$1'$2")
				// 确保句子首字母大写
				.replace(/^[a-z]/, c => c.toUpperCase());
				
			// 如果句子太长，尝试在连接词处分割
			if (sentence.length > 50) {
				const parts = sentence.split(/\b(and|but|or|because|so|then)\b/i);
				if (parts.length > 1) {
					for (let j = 0; j < parts.length; j += 2) {
						const part = parts[j].trim();
						const conjunction = parts[j + 1] || '';
						if (part) {
							cleanedSentences.push(
								part.replace(/^[a-z]/, c => c.toUpperCase()) + 
								(conjunction ? `, ${conjunction}` : '')
							);
						}
					}
					continue;
				}
			}
			
			cleanedSentences.push(sentence + punctuation + ' ');
		}
		
		return cleanedSentences.join('').trim();
	}

	private static cleanChineseText(text: string): string {
		// 1. 基础清理
		const cleanText = text
			.replace(/\s+/g, '')  // 移除所有空格
			.replace(/[【】\[\]]/g, '')
			.replace(/\(.*?\)/g, '')
			.replace(/\{.*?\}/g, '')
			.trim();
		
		// 2. 分段处理
		const segments = [];
		let currentSegment = '';
		let currentLength = 0;
		
		for (let i = 0; i < cleanText.length; i++) {
			const char = cleanText[i];
			currentSegment += char;
			currentLength++;
			
			// 在以下情况分段：
			// 1. 遇到句号、问号、感叹号
			// 2. 遇到转折词
			// 3. 达到最大长度
			// 4. 遇到某些特定词语
			if (
				/[。！？]/.test(char) ||
				currentLength >= 30 ||
				/^(但是|所以|因此|然后|接着|不过|而且|并且)/.test(cleanText.slice(i + 1)) ||
				/(吗|呢|啊|哦|呀|哈|吧)$/.test(currentSegment)
			) {
				// 确保段落结尾有标点
				if (!/[。！？，]$/.test(currentSegment)) {
					currentSegment += '。';
				}
				segments.push(currentSegment);
				currentSegment = '';
				currentLength = 0;
			}
			// 在逗号处适当分段
			else if (char === '，' && currentLength > 15) {
				segments.push(currentSegment);
				currentSegment = '';
				currentLength = 0;
			}
		}
		
		// 处理最后一段
		if (currentSegment) {
			if (!/[。！？，]$/.test(currentSegment)) {
				currentSegment += '。';
			}
			segments.push(currentSegment);
		}
		
		return segments.join('\n');
	}

	private static mergeShortSubtitles(lines: TranscriptLine[]): TranscriptLine[] {
		const MIN_DURATION = 1000;
		const MAX_GAP = 500;
		const MAX_MERGE_LENGTH = 100; // 添加最大合并长度限制
		
		return lines.reduce((acc: TranscriptLine[], current: TranscriptLine, index: number) => {
			if (acc.length === 0) {
				return [current];
			}

			const last = acc[acc.length - 1];
			const gap = current.offset - (last.offset + last.duration);
			const mergedTextLength = (last.text + current.text).length;

			// 判断是否应该合并
			if ((current.duration < MIN_DURATION || gap < MAX_GAP) && 
				mergedTextLength <= MAX_MERGE_LENGTH) {
				last.text += ' ' + current.text;
				last.duration = current.offset + current.duration - last.offset;
				return acc;
			}

			return [...acc, current];
		}, []);
	}

	private static async checkSubtitlesExist(url: string): Promise<boolean> {
		try {
			const videoPageBody = await request(url);
			const parsedBody = parse(videoPageBody);
			const scripts = parsedBody.getElementsByTagName("script");
			const playerScript = scripts.find((script) =>
				script.textContent.includes("var ytInitialPlayerResponse = {"),
			);

			if (!playerScript) return false;

			const dataString = playerScript.textContent
				?.split("var ytInitialPlayerResponse = ")?.[1]
				?.split("};")?.[0] + "}";

			const data = JSON.parse(dataString.trim());
			const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
			
			return Array.isArray(captions) && captions.length > 0;
		} catch (error) {
			return false;
		}
	}
}

export class YoutubeTranscript extends TranscriptFetcher {}
