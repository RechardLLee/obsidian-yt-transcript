import json
import sys
import requests
import argparse
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import re

def load_cookie_from_file(cookie_file):
    try:
        with open(cookie_file, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception as e:
        print(f"读取cookie文件失败: {e}")
        return None

def get_subtitle(bvid, cookie):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://www.bilibili.com',
        'Cookie': cookie
    }

    try:
        # 获取视频信息
        video_info_url = f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}'
        response = requests.get(video_info_url, headers=headers)
        video_info = response.json()
        
        if video_info['code'] != 0:
            return {'success': False, 'message': video_info['message']}

        title = video_info['data']['title']
        aid = video_info['data']['aid']
        print(f"标题:{title}")

        # 获��� cid
        cid_url = f'https://api.bilibili.com/x/web-interface/view?aid={aid}'
        cid_response = requests.get(cid_url, headers=headers)
        cid_data = cid_response.json()
        if cid_data['code'] != 0:
            return {'success': False, 'message': '获取CID失败'}
        
        cid = cid_data['data']['cid']

        # 获取字幕列表
        subtitle_url = f'https://api.bilibili.com/x/player/wbi/v2?aid={aid}&cid={cid}'
        response = requests.get(subtitle_url, headers=headers)
        subtitle_info = response.json()

        if subtitle_info['code'] != 0:
            return {'success': False, 'message': '获取字幕列表失败'}

        subtitles = subtitle_info['data']['subtitle'].get('subtitles', [])
        
        # 获取字幕内容
        if subtitles:
            subtitle = next((s for s in subtitles if 'zh' in s['lan']), subtitles[0])
            subtitle_url = subtitle["subtitle_url"]
            if subtitle_url.startswith('//'):
                subtitle_url = 'https:' + subtitle_url
            
            response = requests.get(subtitle_url, headers=headers)
            if response.status_code == 200:
                subtitle_content = response.json()
                if subtitle_content.get('body'):
                    for line in subtitle_content['body']:
                        print(f"字幕:{json.dumps(line, ensure_ascii=False)}")
                    return
        
        # 如果没有人工字幕，尝试获取AI字幕
        ai_subtitle_url = f'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/{aid}{cid}.json'
        response = requests.get(ai_subtitle_url, headers=headers)
        
        if response.status_code == 200:
            ai_subtitle_content = response.json()
            if ai_subtitle_content.get('body'):
                for line in ai_subtitle_content['body']:
                    print(f"字幕:{json.dumps(line, ensure_ascii=False)}")
                return

        print("字幕:[]")  # 如果没有找到任何字幕，返回空数组
        
    except Exception as e:
        print(f"错误:{str(e)}", file=sys.stderr)
        sys.exit(1)

def run_server():
    app = Flask(__name__)
    # 修改 CORS 配置
    CORS(app, resources={
        r"/*": {
            "origins": ["*"],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization", "Accept"],
            "supports_credentials": True
        }
    })

    @app.route('/', methods=['GET', 'OPTIONS'])
    def home():
        response = jsonify({'status': 'running'})
        # 添加 CORS 头
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')
        response.headers.add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        return response

    @app.route('/get_subtitle', methods=['POST', 'OPTIONS'])
    def handle_subtitle_request():
        if request.method == 'OPTIONS':
            # 处理预检请求
            response = app.make_default_options_response()
            response.headers.update({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept'
            })
            return response

        try:
            data = request.get_json()
            print(f"收到请求数��: {data}")
            
            if not data:
                return jsonify({
                    'success': False,
                    'message': '无效的请求数据',
                    'data': None
                })

            bvid = data.get('bvid')
            cookie = data.get('cookie', '')
            
            if not bvid:
                return jsonify({
                    'success': False,
                    'message': '缺少 BV 号',
                    'data': None
                })
            
            # 从 URL 中提取 BV 号
            if 'bilibili.com' in bvid:
                bvid_match = re.search(r'BV[a-zA-Z0-9]+', bvid)
                if bvid_match:
                    bvid = bvid_match.group(0)
                else:
                    return jsonify({
                        'success': False,
                        'message': '无法从 URL 中提取 BV 号',
                        'data': None
                    })

            print(f"处理字幕请求: BV号={bvid}")
            result = get_subtitle(bvid, cookie)
            
            # 确保响应包含所有必要的字段
            response = jsonify({
                'success': True,
                'message': '获取字幕成功',
                'data': result
            })
            
            # 添加 CORS 头
            response.headers.add('Access-Control-Allow-Origin', '*')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')
            return response

        except Exception as e:
            print(f"处理请求时出错: {str(e)}")
            return jsonify({
                'success': False,
                'message': str(e),
                'data': None
            })

    print("启动服务器在 http://127.0.0.1:6789")
    # 修改服务器配置
    app.run(
        host='127.0.0.1',
        port=6789,
        debug=True,
        threaded=True,
        use_reloader=False  # 禁用重新加载器以避免重复启动
    )

def main():
    parser = argparse.ArgumentParser(description='获取B站视频字幕')
    
    # 创建互斥参数组
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument('--server', action='store_true', help='启动服务器模式')
    mode_group.add_argument('bvid', nargs='?', help='视频的BV号')
    
    parser.add_argument('--cookie', help='B站cookie（可选）', default='')
    parser.add_argument('--cookie-file', help='包含cookie的文件路径', default='cookie.txt')
    parser.add_argument('--output', '-o', help='输出文件路径（可选）')
    
    args = parser.parse_args()
    
    if args.server:
        run_server()
        return
        
    # 优先使用命令行传入的cookie，如果没有则尝试从文件读取
    cookie = args.cookie
    if not cookie and os.path.exists(args.cookie_file):
        cookie = load_cookie_from_file(args.cookie_file)
    
    try:
        result = get_subtitle(args.bvid, cookie)
        
        # 清理结果中的特殊字符
        if isinstance(result, dict):
            if 'title' in result:
                result['title'] = result['title'].encode('utf-8').decode('utf-8', 'ignore')
            if 'lines' in result and isinstance(result['lines'], list):
                for line in result['lines']:
                    if 'text' in line:
                        line['text'] = line['text'].encode('utf-8').decode('utf-8', 'ignore')
        
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
        else:
            # 使用紧凑的JSON格式出，避免额外的空白字符
            print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
            sys.stdout.flush()
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "success": False
        }, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)

if __name__ == '__main__':
    main() 