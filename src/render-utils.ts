import { TranscriptLine } from "./fetch-transcript";
import { TranscriptBlock } from "./types";

/**
 * Highlights matched text in the div
 * @param div - the div that we want to highlight
 * @param searchValue - the value that will be highlight
 */
export const highlightText = (div: HTMLElement, searchValue: string) => {
	const content = div.innerHTML;
	const highlightedContent = content.replace(
		new RegExp(searchValue, "gi"),
		'<span class="yt-transcript__highlight">$&</span>',
	);
	div.innerHTML = highlightedContent;
};

/**
 * Gets an array of transcript render blocks
 * @param data - the transcript data
 * @param timestampMod - the number of seconds between each timestamp
 */
export const getTranscriptBlocks = (
	data: TranscriptLine[],
	timestampMod: number,
	maxWordsPerBlock: number = 100
) => {
	const transcriptBlocks: TranscriptBlock[] = [];
	let quote = "";
	let quoteTimeOffset = 0;
	let wordCount = 0;

	data.forEach((line, i) => {
		const words = line.text.split(/\s+/).length;
		
		// 检查是否需要开始新的块
		if (i === 0 || wordCount + words > maxWordsPerBlock || i % timestampMod === 0) {
			if (quote !== "") {
				transcriptBlocks.push({
					quote: quote.trim(),
					quoteTimeOffset,
				});
			}
			quote = "";
			quoteTimeOffset = line.offset;
			wordCount = 0;
		}

		quote += line.text + " ";
		wordCount += words;
	});

	// 添加最后一个块
	if (quote !== "") {
		transcriptBlocks.push({
			quote: quote.trim(),
			quoteTimeOffset,
		});
	}

	return transcriptBlocks;
};

// 添加段落优化函数
export const optimizeParagraphs = (blocks: TranscriptBlock[]): TranscriptBlock[] => {
	return blocks.reduce((acc: TranscriptBlock[], current, index) => {
		// 检查是否应该与前一个块合并
		if (index > 0 && shouldCombineBlocks(acc[acc.length - 1], current)) {
			const lastBlock = acc[acc.length - 1];
			lastBlock.quote += " " + current.quote;
			return acc;
		}
		
		acc.push(current);
		return acc;
	}, []);
};

const shouldCombineBlocks = (block1: TranscriptBlock, block2: TranscriptBlock): boolean => {
	// 检查两个块是否应该合并的逻辑
	const timeDiff = block2.quoteTimeOffset - block1.quoteTimeOffset;
	const words1 = block1.quote.split(/\s+/).length;
	const words2 = block2.quote.split(/\s+/).length;
	
	return timeDiff < 3000 && // 时间差小于3秒
		   words1 + words2 < 100 && // 合并后的总词数小于100
		   !block1.quote.endsWith('.') && // 第一个块不是完整句子
		   !block2.quote.startsWith('But') && // 第二个块不是新主题
		   !block2.quote.startsWith('However') &&
		   !block2.quote.startsWith('Moreover');
};
