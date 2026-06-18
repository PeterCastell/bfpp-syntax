const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const CONFIG_KEY = "bfpp.compilerPath";


async function promptForCompilerPath() {
    const choice = await vscode.window.showInformationMessage(
        "No bfpp compiler path is configured. Would you like to locate it now?",
        "Browse...",
        "Enter path manually",
        "Cancel"
    );

    if (choice === "Browse...") {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: "Select bfpp compiler",
            filters:
                process.platform === "win32"
                    ? { Executables: ["exe"] }
                    : { All: ["*"] },
        });
        return uris?.[0]?.fsPath;
    }

    if (choice === "Enter path manually") {
        return vscode.window.showInputBox({
            prompt: "Enter the full path to the bfpp compiler executable",
            placeHolder: "/usr/local/bin/bfpp",
            validateInput: (v) => (v.trim() ? null : "Path cannot be empty"),
        });
    }

    return undefined;
}

async function resolveCompilerPath() {
    const config = vscode.workspace.getConfiguration();
    let compilerPath = config.get(CONFIG_KEY, "").trim();

    if (!compilerPath) {
        compilerPath = (await promptForCompilerPath()) ?? "";

        if (!compilerPath) {
            vscode.window.showWarningMessage(
                "Build cancelled: no bfpp compiler path provided."
            );
            return undefined;
        }

        const target = vscode.workspace.workspaceFolders
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;

        await config.update(CONFIG_KEY, compilerPath, target);
        vscode.window.showInformationMessage(`Compiler path saved: ${compilerPath}`);
    }

    return compilerPath;
}

// Compiler runner — streams output to a dedicated output channel

let outputChannel;

function getOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Brainfuck++");
    }
    return outputChannel;
}

function runCompiler(compilerPath, args, cwd) {
    return new Promise((resolve, reject) => {
        const out = getOutputChannel();

        out.clear();
        out.show(true);
        out.appendLine(`> ${path.basename(compilerPath)} ${args.join(" ")}`.trimEnd());

        const LAUNCH_SIGNAL = "-Launch";

        const proc = spawn(compilerPath, args, { cwd });

        let pendingLaunch = null;
        let buffer = "";
        if (args.includes("-redirectLaunch"))
            proc.stdout.on("data", (d) => {
                buffer += d.toString();
                const lines = buffer.split("\n");
                buffer = lines.pop();
                for (const line of lines) {
                    if (line.startsWith(LAUNCH_SIGNAL)) {
                        pendingLaunch = JSON.parse(line.slice(LAUNCH_SIGNAL.length).trim());
                    }
                    else {
                        out.appendLine(line);
                    }
                }
            });
        else
            proc.stdout.on("data", (d) => out.append(d.toString()));

        proc.stderr.on("data", (d) => out.append(d.toString()));

        proc.on("error", (err) => {
            out.appendLine(`\n  Failed to launch compiler: ${err.message}`);
            out.appendLine(`   Check the path in settings: ${CONFIG_KEY}`);
            reject(err);
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve({pendingLaunch: pendingLaunch});
            } else {
                out.appendLine(`Compilation failed with exit code ${code}`);
                reject(new Error(`Compiler exited with code ${code}`));
            }
        });
    });
}


class BfppDebugConfigurationProvider {
    provideDebugConfigurations() {
        return [
            {
                type: "bfpp",
                request: "launch",
                name: "Build Project",
            }
        ];
    }

    async resolveDebugConfiguration(folder, config) {
        // No launch.json: default to "Build Project"
        if (!config.type && !config.request && !config.name) {
            config.type = "bfpp";
            config.request = "launch";
            config.name = "Build Project";
        }

        const compilerPath = await resolveCompilerPath("Build cancelled: no bfpp compiler path provided.");
        if (!compilerPath) return undefined;

        const cwd = folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!cwd && (!config.path || !path.isAbsolute(config.path))) {
            vscode.window.showWarningMessage(
                "Build requires an open workspace folder unless an absolute path is provided."
            );
            return undefined;
        }
        
        try {
            var result = await runCompiler(compilerPath, ["build", "-redirectLaunch", ...(config.path ? [config.path] : [])], cwd);
            if (result.pendingLaunch) {
                config._compilerOut = result;
                config.console = "internalConsole";
                return config;
            }
        } catch { /* reported to output channel */ }


        return undefined;
    }
}

const { EventEmitter } = require("events");

class BfppDebugAdapterFactory {
    createDebugAdapterDescriptor(session) {
        return new vscode.DebugAdapterInlineImplementation(
            new BfppDebugAdapter(session.configuration)
        );
    }
}

class BfppDebugAdapter {
    constructor(config) {
        this.config = config;
        this.proc = null;
        this._onDidSendMessage = new vscode.EventEmitter();
        this.onDidSendMessage = this._onDidSendMessage.event;
    }

    async handleMessage(message) {
        const out = getOutputChannel();

        if (message.command === "initialize") {
            // Acknowledge capabilities
            this.send({ type: "response", request_seq: message.seq, success: true, command: "initialize", body: {} });
            this.send({ type: "event", event: "initialized" });

        } else if (message.command === "launch") {
            this.send({ type: "response", request_seq: message.seq, success: true, command: "launch" });
            
            const { exe, cwd, args } = this.config._compilerOut.pendingLaunch;

            this.proc = spawn(exe, args, { cwd });

            this.proc.stdout.on("data", (d) => {
                this.send({ type: "event", event: "output", body: { category: "stdout", output: d.toString() } });
            });

            this.proc.stderr.on("data", (d) => {
                this.send({ type: "event", event: "output", body: { category: "stderr", output: d.toString() } });
            });

            this.proc.on("error", (err) => {
                this.send({ type: "event", event: "output", body: { category: "stderr", output: `Failed to launch: ${err.message}\n` } });
                this.sendTerminated();
            });

            this.proc.on("close", (code) => {
                this.send({ type: "event", event: "output", body: { category: "stdout", output: `\nProgram exited with code ${code}\n` } });
                this.sendTerminated();
            });
        } else if (message.command === "evaluate") {
            // Debug Console input — forward to the process's stdin
            if (this.proc && !this.proc.killed) {
                this.proc.stdin.write(message.arguments.expression + "\n");
            }
            this.send({ type: "response", request_seq: message.seq, success: true, command: "evaluate", body: { result: "", variablesReference: 0 } });
        } else if (message.command === "disconnect" || message.command === "terminate") {
            this.proc?.kill();
            this.send({ type: "response", request_seq: message.seq, success: true, command: message.command });
            this.sendTerminated();

        } else {
            // Acknowledge anything else we don't handle (threads, scopes, etc.)
            this.send({ type: "response", request_seq: message.seq, success: true, command: message.command, body: {} });
        }
    }

    send(message) {
        this._onDidSendMessage.fire(message);
    }

    sendTerminated() {
        this.send({ type: "event", event: "terminated" });
        this.send({ type: "event", event: "exited", body: { exitCode: 0 } });
    }

    dispose() {
        this.proc?.kill();
    }
}


module.exports = { BfppDebugConfigurationProvider, runCompiler, resolveCompilerPath, getOutputChannel, BfppDebugAdapterFactory };
