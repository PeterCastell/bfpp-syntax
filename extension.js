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

const vscode = require("vscode");
const { BfppDebugConfigurationProvider, runCompiler, resolveCompilerPath, BfppDebugAdapterFactory } = require("./bfppDebugProvider");

const tmGrammar = require('./syntaxes/bfpp.tmLanguage.json');
const { createHighlighter } = require("shiki");

let highlighter = null;
createHighlighter({
    themes: ['dark-plus'],
    langs: [tmGrammar]
}).then(h => {
    highlighter = h;
    vscode.commands.executeCommand('markdown.preview.refresh');
})

function activate(context) {

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(
            "bfpp",
            new BfppDebugConfigurationProvider(),
            vscode.DebugConfigurationProviderTriggerKind.Dynamic
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("bfpp.init", async () => {
            let targetDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            let shouldOpen = false;
        
            if (!targetDir) {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: "Initialize project here",
                });
                targetDir = uris?.[0]?.fsPath;
                shouldOpen = true;
            }
        
            if (!targetDir) return;

            const compilerPath = await resolveCompilerPath("Init cancelled: no bfpp compiler path provided.");
            if (!compilerPath) return;
        
            try {
                await runCompiler(compilerPath, ["init"], targetDir);
            } catch {
                // Error already reported to the output channel
            }

            if (shouldOpen)
                await vscode.commands.executeCommand(
                    "vscode.openFolder",
                    vscode.Uri.file(targetDir),
                    false
                )
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("bfpp.runFile", async () => {
            const filePath = vscode.window.activeTextEditor?.document.fileName;

            if (!filePath || !filePath.endsWith(".bfpp")) {
                vscode.window.showWarningMessage("Run File: active file is not a .bfpp file.");
                return;
            }

            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(filePath);

            const compilerPath = await resolveCompilerPath();
            if (!compilerPath) return;

            const existing = vscode.window.terminals.find(t => t.name === "Brainfuck++");
            const terminal = existing ?? vscode.window.createTerminal({ 
                name: "Brainfuck++", 
                cwd 
            });
            terminal.show();
            terminal.sendText(`& "${compilerPath}" "build" "${filePath}"`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("bfpp.setCompilerPath", async () => {
            const config = vscode.workspace.getConfiguration();
            const current = config.get("bfpp.compilerPath", "");

            const choice = await vscode.window.showQuickPick(
                ["Browse...", "Enter path manually"],
                { placeHolder: current || "No compiler path set" }
            );

            if (!choice) return;

            let newPath;
            if (choice === "Browse...") {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: "Select bfpp compiler",
                    filters: process.platform === "win32"
                        ? { Executables: ["exe", "cmd", "bat"] }
                        : { All: ["*"] },
                });
                newPath = uris?.[0]?.fsPath;
            } else {
                newPath = await vscode.window.showInputBox({
                    prompt: "Enter the full path to the bfpp compiler executable",
                    value: current,
                    placeHolder: "/usr/local/bin/bfpp",
                    validateInput: (v) => (v.trim() ? null : "Path cannot be empty"),
                });
            }

            if (!newPath) return;

            const target = vscode.workspace.workspaceFolders
                ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
            await config.update("bfpp.compilerPath", newPath.trim(), target);
            vscode.window.showInformationMessage(`Compiler path updated: ${newPath}`);
        })
    );

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            "bfpp",
            new BfppDebugAdapterFactory()
        )
    );


    return {
        extendMarkdownIt(md) {
        const defaultFence = md.renderer.rules.fence;
        md.renderer.rules.fence = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            if (token.info.trim() === 'bfpp') {
                if (highlighter) {
                    console.log("grammar keys:", Object.keys(tmGrammar));
                    console.log("repository keys:", Object.keys(tmGrammar.repository));
                    console.log("first pattern:", JSON.stringify(tmGrammar.patterns[0]));
                    return highlighter.codeToHtml(token.content, {
                        lang: 'Brainfuck++',
                        theme: 'dark-plus'
                    });
                }
                // fallback if shiki hasn't loaded yet
                return `<pre><code>${token.content}</code></pre>`;
            }
            return defaultFence(tokens, idx, options, env, self);
        };
        return md;
    }
    };
}

function deactivate() {}


module.exports = { activate, deactivate };