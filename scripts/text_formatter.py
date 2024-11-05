from transformers import AutoTokenizer, AutoModelForTokenClassification
import torch
import re

def format_text(text):
    # 基础清理
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'[【】\[\]\(\)\{\}]', '', text)
    
    # 使用预训练模型进行分句
    try:
        tokenizer = AutoTokenizer.from_pretrained("bert-base-chinese")
        model = AutoModelForTokenClassification.from_pretrained("bert-base-chinese")
        
        # 将文本分成较小的块以避免超出最大长度限制
        max_length = 510  # BERT最大长度为512，留出一些空间给特殊标记
        chunks = [text[i:i + max_length] for i in range(0, len(text), max_length)]
        
        segments = []
        for chunk in chunks:
            # 对每个块进行处理
            inputs = tokenizer(chunk, return_tensors="pt", truncation=True)
            outputs = model(**inputs)
            
            # 使用模型输出来确定句子边界
            logits = outputs.logits
            predictions = torch.argmax(logits, dim=2)
            
            # 根据预测结果分段
            tokens = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
            current_segment = ""
            
            for token, pred in zip(tokens[1:-1], predictions[0][1:-1]):  # 跳过[CLS]和[SEP]标记
                if token.startswith("##"):
                    current_segment += token[2:]
                else:
                    current_segment += token
                
                # 在句子边界处分段
                if pred == 1 or len(current_segment) >= 50:  # 1表示句子边界
                    if current_segment:
                        if not any(current_segment.endswith(mark) for mark in ['。', '！', '？']):
                            current_segment += '。'
                        segments.append(current_segment)
                        current_segment = ""
            
            # 处理最后一个段落
            if current_segment:
                if not any(current_segment.endswith(mark) for mark in ['。', '！', '？']):
                    current_segment += '。'
                segments.append(current_segment)
    
    except Exception as e:
        # 如果模型加载失败，使用简单的规则分段
        segments = []
        current_segment = ""
        
        for char in text:
            current_segment += char
            if char in ['。', '！', '？'] or len(current_segment) >= 50:
                segments.append(current_segment)
                current_segment = ""
        
        if current_segment:
            segments.append(current_segment + '。')
    
    return '\n'.join(segments)

if __name__ == '__main__':
    import sys
    text = sys.stdin.read()
    print(format_text(text)) 