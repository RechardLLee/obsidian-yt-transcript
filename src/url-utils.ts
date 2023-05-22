const MarkdownUrlPattern =
	/\[([^\[\]]*)\]\((https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})\)/gi;
const UrlPattern =
	/(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi;

function _cursorWithinBoundaries(
	cursorPosition: number,
	startIndex: number,
	length: number
): boolean {
	let endIndex = startIndex + length;

	return startIndex <= cursorPosition && cursorPosition <= endIndex;
}

export function getUrlFromText(
	lineText: string,
	cursorPosition: number
): [number, number] {
	// First check if we're in a link
	let linksInLine = lineText.matchAll(MarkdownUrlPattern);

	for (let match of linksInLine) {
		if (
			_cursorWithinBoundaries(
				cursorPosition,
				match.index ?? 0,
				match[0].length
			)
		) {
			return [match.index ?? 0, (match.index ?? 0) + match[0].length];
		}
	}

	// If not, check if we're in just a standard ol' URL.
	let urlsInLine = lineText.matchAll(UrlPattern);

	for (let match of urlsInLine) {
		if (
			_cursorWithinBoundaries(
				cursorPosition,
				match.index ?? 0,
				match[0].length
			)
		) {
			return [match.index ?? 0, (match.index ?? 0) + match[0].length];
		}
	}

	return [cursorPosition, cursorPosition];
}

/**
 * Matches a YouTube URL
 * @example
 * https://www.youtube.com/watch?v=QH2-TGUlwu4
 * @example
 * https://youtube.com/watch?v=QH2-TGUlwu4
 */
const YOUTUBE_REGEX = new RegExp(
	/^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/
);

/**
 * Checks if a string is a valid YouTube URL
 */
export const isValidYoutubeURL = (value: string): boolean => {
	return value.match(YOUTUBE_REGEX) !== null;
};
