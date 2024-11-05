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
					lang: config?.lang
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

		return {
			title: title,
			lines: chunks.map((cue: any) => ({
				text: cue.textContent
					.replaceAll("&#39;", "'")
					.replaceAll("&amp;", "&")
					.replaceAll("&quot;", '"')
					.replaceAll("&apos;", "'")
					.replaceAll("&lt;", "<")
					.replaceAll("&gt;", ">"),
				duration: parseFloat(cue.attributes.dur) * 1000,
				offset: parseFloat(cue.attributes.start) * 1000,
			})),
		};
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
