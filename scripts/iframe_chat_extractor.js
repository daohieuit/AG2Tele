/**
 * 🎯 Iframe Chat Extractor v1.1
 * 
 * Truy cập vào iframe cascade-panel.html để extract AI responses
 * Paste vào Console của Antigravity DevTools
 * 
 * v1.1: Fixed className.substring error for SVG elements
 */

(function () {
    console.log('🎯 Iframe Chat Extractor v1.1 - Starting...');
    console.log('');

    // Helper: Safely get className as string (handles SVG and undefined)
    function getClassName(el) {
        if (!el) return '';
        const cls = el.className;
        if (typeof cls === 'string') return cls;
        if (cls && typeof cls.baseVal === 'string') return cls.baseVal; // SVGAnimatedString
        return '';
    }

    // ============================================
    // 1. Tìm iframe cascade-panel
    // ============================================
    console.log('=== STEP 1: FINDING CASCADE IFRAME ===');

    const iframes = document.querySelectorAll('iframe');
    let cascadeFrame = null;

    iframes.forEach((iframe, i) => {
        const src = iframe.src || '';
        const className = iframe.className || '';
        console.log(`[${i + 1}] iframe:`, src.substring(0, 80), 'class:', className);

        if (src.includes('cascade-panel') || className.includes('agentPanel')) {
            cascadeFrame = iframe;
            console.log('  ✅ Found cascade-panel iframe!');
        }
    });

    if (!cascadeFrame) {
        console.error('❌ Không tìm thấy cascade-panel iframe!');
        console.log('Thử tìm bằng class...');

        // Thử tìm bằng attribute
        cascadeFrame = document.querySelector('iframe[class*="agent"]') ||
            document.querySelector('iframe[class*="cascade"]') ||
            document.querySelector('iframe[class*="panel"]');

        if (cascadeFrame) {
            console.log('✅ Tìm thấy iframe bằng class selector');
        }
    }

    if (!cascadeFrame) {
        console.error('❌ Không thể tìm thấy iframe chứa chat panel!');
        console.log('');
        console.log('Liệt kê tất cả iframes với details:');
        iframes.forEach((iframe, i) => {
            console.log(`[${i + 1}]`, {
                src: iframe.src,
                id: iframe.id,
                class: iframe.className,
                name: iframe.name
            });
        });
        return;
    }

    // ============================================
    // 2. Thử access iframe content
    // ============================================
    console.log('');
    console.log('=== STEP 2: ACCESSING IFRAME CONTENT ===');

    let iframeDoc;
    try {
        iframeDoc = cascadeFrame.contentDocument || cascadeFrame.contentWindow?.document;

        if (!iframeDoc) {
            console.error('❌ Không thể truy cập iframe document (có thể do cross-origin)');
            console.log('Iframe src:', cascadeFrame.src);
            return;
        }

        console.log('✅ Successfully accessed iframe document!');
        console.log('   Title:', iframeDoc.title);
        console.log('   Body children:', iframeDoc.body?.childElementCount);

    } catch (e) {
        console.error('❌ Cross-origin error:', e.message);
        console.log('');
        console.log('💡 Workaround: Thử inject script vào iframe...');
        return;
    }

    // ============================================
    // 3. Explore iframe DOM structure
    // ============================================
    console.log('');
    console.log('=== STEP 3: EXPLORING IFRAME DOM ===');

    // Tìm tất cả elements có class liên quan đến chat
    const chatKeywords = ['message', 'chat', 'turn', 'response', 'assistant', 'user', 'agent', 'content', 'text', 'bubble', 'stream'];

    chatKeywords.forEach(keyword => {
        const els = iframeDoc.querySelectorAll(`[class*="${keyword}" i]`);
        if (els.length > 0) {
            console.log(`Found ${els.length} elements with class "${keyword}":`);
            els.forEach((el, i) => {
                if (i < 5) { // Show first 5
                    const text = el.textContent?.trim() || '';
                    const cls = getClassName(el);
                    console.log(`  [${i + 1}] ${el.tagName}.${cls.substring(0, 40)}`);
                    if (text.length > 20 && text.length < 300) {
                        console.log(`       Text: ${text.substring(0, 80)}...`);
                    }
                }
            });
        }
    });

    // ============================================
    // 4. Tìm tất cả text dài trong iframe
    // ============================================
    console.log('');
    console.log('=== STEP 4: FINDING LONG TEXT IN IFRAME ===');

    const walker = iframeDoc.createTreeWalker(
        iframeDoc.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let node;
    let textCount = 0;
    const longTexts = [];

    while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text.length > 50) {
            textCount++;
            const parent = node.parentElement;
            longTexts.push({
                text: text.substring(0, 150),
                parent: parent?.tagName + '.' + (parent?.className?.substring(0, 30) || ''),
                path: getPath(parent)
            });
        }
    }

    console.log(`Found ${textCount} text nodes with > 50 chars:`);
    longTexts.slice(0, 20).forEach((item, i) => {
        console.log(`\n[${i + 1}]`);
        console.log('  Text:', item.text + '...');
        console.log('  Parent:', item.parent);
        console.log('  Path:', item.path);
    });

    // ============================================
    // 5. Check for Shadow DOM inside iframe
    // ============================================
    console.log('');
    console.log('=== STEP 5: CHECKING SHADOW DOM IN IFRAME ===');

    const allInIframe = iframeDoc.querySelectorAll('*');
    let shadowInIframe = 0;

    allInIframe.forEach(el => {
        if (el.shadowRoot) {
            shadowInIframe++;
            console.log('Shadow root in iframe:', el.tagName, el.className);

            // Try to access shadow content
            const shadowContent = el.shadowRoot.textContent?.substring(0, 200);
            if (shadowContent) {
                console.log('  Shadow content:', shadowContent);
            }
        }
    });
    console.log(`Total shadow roots in iframe: ${shadowInIframe}`);

    // ============================================
    // 6. Install observer on iframe
    // ============================================
    console.log('');
    console.log('=== STEP 6: INSTALLING IFRAME OBSERVER ===');

    window.__iframeObserver = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            if (m.addedNodes.length) {
                m.addedNodes.forEach(node => {
                    const text = node.textContent?.trim();
                    if (text && text.length > 30 && text.length < 1000) {
                        console.log('🆕 NEW IN IFRAME:', node.nodeName);
                        console.log('   Class:', node.className?.substring(0, 50));
                        console.log('   Text:', text.substring(0, 150));
                        console.log('   Parent:', m.target?.tagName, m.target?.className?.substring(0, 30));
                    }
                });
            }

            // Also watch for text changes
            if (m.type === 'characterData') {
                const text = m.target.textContent?.trim();
                if (text && text.length > 30) {
                    console.log('📝 TEXT CHANGED:', text.substring(0, 150));
                }
            }
        });
    });

    window.__iframeObserver.observe(iframeDoc.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    console.log('✅ Iframe observer installed!');
    console.log('   Send a message and watch for 🆕 NEW IN IFRAME logs');
    console.log('');
    console.log('To stop: window.__iframeObserver.disconnect()');

    // ============================================
    // Helper: Get element path
    // ============================================
    function getPath(el) {
        if (!el) return '';
        const path = [];
        while (el && el !== iframeDoc.body) {
            let selector = el.tagName?.toLowerCase() || '';
            const cls = getClassName(el);
            if (el.id) selector += '#' + el.id;
            else if (cls) selector += '.' + cls.split(' ')[0];
            path.unshift(selector);
            el = el.parentElement;
        }
        return path.slice(-4).join(' > ');
    }

    // ============================================
    // Export reference
    // ============================================
    window.__cascadeFrame = cascadeFrame;
    window.__cascadeDoc = iframeDoc;

    console.log('');
    console.log('📌 Saved references:');
    console.log('   window.__cascadeFrame - iframe element');
    console.log('   window.__cascadeDoc - iframe document');
    console.log('');
    console.log('💡 Example queries:');
    console.log('   window.__cascadeDoc.querySelectorAll("[class*=message]")');
    console.log('   window.__cascadeDoc.body.innerHTML.substring(0, 1000)');

})();
