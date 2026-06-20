/**
 * Script để inspect DOM và tìm Model Selector trong Antigravity
 * 
 * Cách dùng:
 * node scripts/inspect_model_selector.js
 */

const CDP = require('chrome-remote-interface');

async function inspectModelSelector() {
    let client;

    try {
        // Kết nối CDP
        client = await CDP({ port: 9000 });
        const { Runtime, DOM } = client;

        await Runtime.enable();
        await DOM.enable();

        console.log('🔍 Đang tìm Model Selector...\n');

        // Danh sách các selector có thể có
        const possibleSelectors = [
            // Dropdown/Select elements
            'select[aria-label*="model" i]',
            'select[aria-label*="Model" i]',
            '[data-testid*="model"]',
            '[class*="model-selector"]',
            '[class*="modelSelector"]',
            '[id*="model-select"]',

            // Button/Dropdown triggers
            'button[aria-label*="model" i]',
            'button[aria-label*="Select model" i]',
            '[role="combobox"][aria-label*="model" i]',

            // Agent panel selectors
            '[class*="agent-panel"] select',
            '[class*="agent-panel"] [role="combobox"]',
            '[class*="conversation"] select',

            // Generic
            'select',
            '[role="combobox"]',
            '[role="listbox"]'
        ];

        const results = [];

        for (const selector of possibleSelectors) {
            try {
                const result = await Runtime.evaluate({
                    expression: `
                        (function() {
                            const elements = document.querySelectorAll('${selector}');
                            if (elements.length === 0) return null;
                            
                            return Array.from(elements).map(el => ({
                                selector: '${selector}',
                                tagName: el.tagName,
                                id: el.id,
                                className: el.className,
                                ariaLabel: el.getAttribute('aria-label'),
                                dataTestId: el.getAttribute('data-testid'),
                                textContent: el.textContent?.substring(0, 100),
                                innerHTML: el.innerHTML?.substring(0, 200)
                            }));
                        })()
                    `,
                    returnByValue: true
                });

                if (result.result.value) {
                    results.push({
                        selector,
                        elements: result.result.value
                    });
                }
            } catch (e) {
                // Skip invalid selectors
            }
        }

        // Hiển thị kết quả
        if (results.length === 0) {
            console.log('❌ Không tìm thấy Model Selector');
            console.log('\n💡 Gợi ý:');
            console.log('1. Mở Agent Panel (Ctrl+L)');
            console.log('2. Đảm bảo model selector đang hiển thị');
            console.log('3. Chạy lại script này');
        } else {
            console.log('✅ Tìm thấy các element có thể là Model Selector:\n');

            results.forEach((result, index) => {
                console.log(`\n--- Kết quả ${index + 1} ---`);
                console.log(`Selector: ${result.selector}`);
                console.log(`Số lượng: ${result.elements.length}`);

                result.elements.forEach((el, i) => {
                    console.log(`\n  Element ${i + 1}:`);
                    console.log(`    Tag: ${el.tagName}`);
                    if (el.id) console.log(`    ID: ${el.id}`);
                    if (el.className) console.log(`    Class: ${el.className}`);
                    if (el.ariaLabel) console.log(`    Aria-Label: ${el.ariaLabel}`);
                    if (el.dataTestId) console.log(`    Data-TestId: ${el.dataTestId}`);
                    if (el.textContent) console.log(`    Text: ${el.textContent}`);
                });
            });

            // Tìm model options
            console.log('\n\n🔍 Đang tìm Model Options...\n');

            const optionsResult = await Runtime.evaluate({
                expression: `
                    (function() {
                        const options = document.querySelectorAll('option, [role="option"]');
                        return Array.from(options)
                            .filter(opt => {
                                const text = opt.textContent.toLowerCase();
                                return text.includes('gemini') || 
                                       text.includes('claude') || 
                                       text.includes('gpt') ||
                                       text.includes('model');
                            })
                            .map(opt => ({
                                tagName: opt.tagName,
                                value: opt.value,
                                textContent: opt.textContent,
                                className: opt.className,
                                dataValue: opt.getAttribute('data-value')
                            }));
                    })()
                `,
                returnByValue: true
            });

            if (optionsResult.result.value && optionsResult.result.value.length > 0) {
                console.log('✅ Tìm thấy Model Options:\n');
                optionsResult.result.value.forEach((opt, i) => {
                    console.log(`  ${i + 1}. ${opt.textContent}`);
                    console.log(`     Value: ${opt.value || opt.dataValue || 'N/A'}`);
                    console.log(`     Class: ${opt.className || 'N/A'}`);
                });
            }
        }

        console.log('\n\n📝 Lưu kết quả vào file...');
        const fs = require('fs');
        fs.writeFileSync(
            'd:/01_BUILD_APP/REMOTE_AGENT/.artifacts/model_selector_inspection.json',
            JSON.stringify(results, null, 2)
        );
        console.log('✅ Đã lưu vào .artifacts/model_selector_inspection.json');

    } catch (error) {
        console.error('❌ Lỗi:', error.message);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

inspectModelSelector();
