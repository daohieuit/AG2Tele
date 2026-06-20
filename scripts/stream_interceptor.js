/**
 * 🎯 Antigravity Stream Interceptor
 * Copy và paste toàn bộ script này vào Console của Antigravity DevTools (F12)
 * 
 * Script này intercept các streaming responses chứa AI chat data
 */

(function () {
    console.log('🚀 Antigravity Stream Interceptor - Installing...');

    // Lưu trữ captured responses
    window.__capturedResponses = [];

    // =========================================
    // 1. INTERCEPT FETCH (cho streaming requests)
    // =========================================
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const response = await originalFetch.apply(this, args);

        // Chỉ intercept các Stream requests
        if (url.includes('Stream') || url.includes('Cascade') || url.includes('Live')) {
            console.log('📡 [STREAM DETECTED]', url);

            // Clone response để đọc stream
            const clone = response.clone();

            // Đọc streaming response
            try {
                const reader = clone.body?.getReader();
                if (reader) {
                    const decoder = new TextDecoder();
                    let fullText = '';

                    // Đọc từng chunk
                    const processStream = async () => {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            const chunk = decoder.decode(value, { stream: true });
                            fullText += chunk;

                            // Log mỗi chunk (có thể chứa text response)
                            if (chunk.length > 10) {
                                console.log('📦 [CHUNK]', chunk.substring(0, 200));

                                // Thử parse nếu là text readable
                                if (chunk.includes('"') || /[a-zA-Z]{3,}/.test(chunk)) {
                                    window.__capturedResponses.push({
                                        timestamp: new Date().toISOString(),
                                        url: url,
                                        chunk: chunk
                                    });
                                }
                            }
                        }

                        console.log('✅ [STREAM COMPLETE]', url);
                        console.log('📄 Total length:', fullText.length);

                        // Lưu full response
                        window.__capturedResponses.push({
                            timestamp: new Date().toISOString(),
                            url: url,
                            fullText: fullText,
                            type: 'complete'
                        });
                    };

                    processStream().catch(e => console.log('Stream read error:', e));
                }
            } catch (e) {
                console.log('⚠️ Could not read stream:', e.message);
            }
        }

        return response;
    };

    // =========================================
    // 2. INTERCEPT EventSource (SSE)
    // =========================================
    const OriginalEventSource = window.EventSource;

    if (OriginalEventSource) {
        window.EventSource = function (url, config) {
            console.log('📡 [SSE DETECTED]', url);

            const eventSource = new OriginalEventSource(url, config);

            eventSource.addEventListener('message', function (e) {
                console.log('📨 [SSE MESSAGE]', e.data?.substring(0, 200));
                window.__capturedResponses.push({
                    timestamp: new Date().toISOString(),
                    url: url,
                    type: 'sse',
                    data: e.data
                });
            });

            return eventSource;
        };
    }

    // =========================================
    // 3. DOM MUTATION OBSERVER (backup)
    // =========================================
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach((node) => {
                    const text = node.textContent || '';
                    // Chỉ log text dài (likely AI response)
                    if (text.length > 100 && !text.includes('function') && !text.includes('const ')) {
                        console.log('🔍 [DOM ADDED]', text.substring(0, 150) + '...');
                    }
                });
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // =========================================
    // 4. HELPER FUNCTIONS
    // =========================================

    // Xem tất cả captured responses
    window.viewCaptured = function () {
        console.table(window.__capturedResponses);
        return window.__capturedResponses;
    };

    // Export captured data
    window.exportCaptured = function () {
        const data = JSON.stringify(window.__capturedResponses, null, 2);
        console.log(data);
        return data;
    };

    // Clear captured data
    window.clearCaptured = function () {
        window.__capturedResponses = [];
        console.log('🗑️ Cleared all captured responses');
    };

    // =========================================
    console.log('✅ Antigravity Stream Interceptor - READY!');
    console.log('📝 Commands:');
    console.log('   viewCaptured()  - Xem tất cả responses đã capture');
    console.log('   exportCaptured() - Export ra JSON');
    console.log('   clearCaptured()  - Xóa data');
    console.log('');
    console.log('🎯 Hãy gửi một tin nhắn để test...');
})();
