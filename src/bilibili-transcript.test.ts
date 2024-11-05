import { BilibiliTranscript, BilibiliTranscriptError } from './bilibili-transcript';

describe('BilibiliTranscript', () => {
    // 模拟全局 fetch
    const mockFetch = jest.fn();
    const originalFetch = global.fetch;

    beforeAll(() => {
        // 保存原始的 fetch
        global.fetch = mockFetch;
    });

    afterAll(() => {
        // 恢复原始的 fetch
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        // 每个测试前重置 mock
        mockFetch.mockReset();
    });

    describe('fetchTranscript', () => {
        const validBilibiliUrl = 'https://www.bilibili.com/video/BV1234567890';
        const invalidUrl = 'https://www.invalid.com/video';

        it('应该成功获取视频字幕', async () => {
            // 模拟视频信息响应
            mockFetch
                // 视频信息
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            title: '测试视频',
                            aid: 12345
                        }
                    })
                }))
                // cid
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: [{
                            cid: 67890
                        }]
                    })
                }))
                // 人工字幕
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            subtitle: {
                                subtitles: [{
                                    lan: 'zh-CN',
                                    subtitle_url: '//example.com/subtitle.json'
                                }]
                            }
                        }
                    })
                }))
                // 字幕内容
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        body: [{
                            content: '测试字幕内容',
                            from: 1.0,
                            to: 2.0
                        }]
                    })
                }));

            const result = await BilibiliTranscript.fetchTranscript(validBilibiliUrl);

            expect(result).toEqual({
                title: '测试视频',
                lines: [{
                    text: '测试字幕内容',
                    duration: 1000,
                    offset: 1000
                }]
            });
        });

        it('应该处理无效的 URL', async () => {
            await expect(BilibiliTranscript.fetchTranscript(invalidUrl))
                .rejects
                .toThrow('无法识别的 Bilibili 视频链接');
        });

        it('应该处理视频信息获取失败', async () => {
            mockFetch.mockImplementationOnce(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    code: -1,
                    message: '视频不存在'
                })
            }));

            await expect(BilibiliTranscript.fetchTranscript(validBilibiliUrl))
                .rejects
                .toThrow('视频不存在');
        });

        it('应该处理无字幕的情况', async () => {
            mockFetch
                // 视频信息
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            title: '测试视频',
                            aid: 12345
                        }
                    })
                }))
                // cid
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: [{
                            cid: 67890
                        }]
                    })
                }))
                // 空字幕列表
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            subtitle: {
                                subtitles: []
                            }
                        }
                    })
                }))
                // AI 字幕也不存在
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: null
                    })
                }));

            await expect(BilibiliTranscript.fetchTranscript(validBilibiliUrl))
                .rejects
                .toThrow('该视频没有可用字幕');
        });

        it('应该正确处理 cookie 设置', async () => {
            const testCookie = 'SESSDATA=abc123';
            BilibiliTranscript.setCookie(testCookie);

            mockFetch
                // 视频信息
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            title: '测试视频',
                            aid: 12345
                        }
                    })
                }))
                // cid
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: [{
                            cid: 67890
                        }]
                    })
                }))
                // 人工字幕列表
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            subtitle: {
                                subtitles: [{
                                    lan: 'zh-CN',
                                    subtitle_url: '//example.com/subtitle.json'
                                }]
                            }
                        }
                    })
                }))
                // 字幕内容
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        body: [{
                            content: '测试字幕内容',
                            from: 1.0,
                            to: 2.0
                        }]
                    })
                }));

            await BilibiliTranscript.fetchTranscript(validBilibiliUrl);

            // 验证所有请求是否都包含了正确的 cookie
            const calls = mockFetch.mock.calls;
            calls.forEach(call => {
                expect(call[1]).toMatchObject({
                    headers: expect.objectContaining({
                        'Cookie': testCookie
                    })
                });
            });
        });

        it('应该能成���获取AI字幕', async () => {
            mockFetch
                // 视频信息
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            title: '测试视频',
                            aid: 12345
                        }
                    })
                }))
                // cid
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: [{
                            cid: 67890
                        }]
                    })
                }))
                // 空的人工字幕列表
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            subtitle: {
                                subtitles: []
                            }
                        }
                    })
                }))
                // AI字幕
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            voice_timeline: [{
                                content: 'AI生成的字幕内容',
                                start: 1000,
                                end: 2000
                            }]
                        }
                    })
                }));

            const result = await BilibiliTranscript.fetchTranscript(validBilibiliUrl);

            expect(result).toEqual({
                title: '测试视频',
                lines: [{
                    text: 'AI生成的字幕内容',
                    duration: 1000,
                    offset: 1000
                }]
            });
        });

        it('应该优先使用人工字幕而不是AI字幕', async () => {
            mockFetch
                // 视频信息
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            title: '测试视频',
                            aid: 12345
                        }
                    })
                }))
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: [{
                            cid: 67890
                        }]
                    })
                }))
                // 人工字幕存在
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 0,
                        data: {
                            subtitle: {
                                subtitles: [{
                                    lan: 'zh-CN',
                                    subtitle_url: '//example.com/subtitle.json'
                                }]
                            }
                        }
                    })
                }))
                // 字幕内容
                .mockImplementationOnce(() => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        body: [{
                            content: '人工字幕内容',
                            from: 1.0,
                            to: 2.0
                        }]
                    })
                }));

            const result = await BilibiliTranscript.fetchTranscript(validBilibiliUrl);

            expect(result).toEqual({
                title: '测试视频',
                lines: [{
                    text: '人工字幕内容',
                    duration: 1000,
                    offset: 1000
                }]
            });
        });
    });
}); 