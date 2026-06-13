// const { LanguageClient, TransportKind } = require('vscode-languageclient/node.js');

// let client;

// function activate(context) {
//     const serverOptions = {
//         command: `C:\\Users\\Peter\\Documents\\Programming Projects\\brainfuck\\brainfuck++\\BrainfuckPlusPlus\\bin\\Debug\\net10.0\\BrainfuckPlusPlus.exe`,
//         args: ['--lsp'],
//         transport: TransportKind.stdio
//     };

//     const clientOptions = {
//         documentSelector: [{ scheme: 'file', language: 'bfpp' }]
//     };

//     client = new LanguageClient('bfpp', 'BFPP Language Server', serverOptions, clientOptions);
//     client.start();
// }

// function deactivate() {
//     return client?.stop();
// }

module.exports = { activate, deactivate };

const bfpp = require('./bfpp-highlight');
const hljs = require('highlight.js');

hljs.registerLanguage('bfpp', bfpp);

function activate() {
    return {
        extendMarkdownIt(md) {
            // Store VS Code's default TextMate renderer
            const defaultFence = md.renderer.rules.fence;

            // Override the fence renderer
            md.renderer.rules.fence = (tokens, idx, options, env, self) => {
                const token = tokens[idx];
                
                // If it's a Brainfuck++ block, hijack the rendering
                if (token.info.trim() === 'bfpp') {
                    try {
                        const highlighted = hljs.highlight(token.content, { language: 'bfpp' }).value;
                        return `<pre><code class="hljs language-bfpp">${highlighted}</code></pre>`;
                    } catch (err) {
                        console.error('Highlight.js failed to render bfpp:', err);
                    }
                }
                
                // Otherwise, pass it back to VS Code's default TextMate renderer
                return defaultFence(tokens, idx, options, env, self);
            };
            
            return md;
        }
    };
}

function deactivate() {}