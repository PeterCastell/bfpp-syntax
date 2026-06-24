const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const net = require("net");
const { EventEmitter } = require("events");


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

function runCompiler(compilerPath, args, cwd) {
    return new Promise((resolve, reject) => {

        out.clear();
        out.show(true);
        out.info(`> ${path.basename(compilerPath)} ${args.join(" ")}`.trimEnd());

        const LAUNCH_SIGNAL = "-Launch";

        const proc = spawn(compilerPath, args, { cwd });

        proc.stdout.on("data", (d) => out.append(d.toString()));
        proc.stderr.on("data", (d) => out.append(d.toString()));

        proc.on("error", (err) => {
            vscode.window.showErrorMessage(`Failed to launch compiler: ${err.message}`);
            reject(err);
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve({pendingLaunch: pendingLaunch});
            } else {
                vscode.window.showErrorMessage(`Compiler execution failed with exit code: ${code}`);
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
        config.compilerPath = compilerPath
        config.cwd = cwd

        config.console = "internalConsole";
        return config;
    }
}


class BfppDebugAdapterFactory {
    createDebugAdapterDescriptor(session) {
        return new vscode.DebugAdapterInlineImplementation(
            new BfppDebugAdapter(session.configuration)
        );
    }
}

var ideServer;

class BfppDebugAdapter {
    constructor(config) {
        this.config = config;
        this._onDidSendMessage = new vscode.EventEmitter();
        this.onDidSendMessage = this._onDidSendMessage.event;
        this._seq = 1;
    }

    async handleMessage(message) {
        if (message.command === "initialize") {
            this.send({ type: "response", request_seq: message.seq, success: true, command: "initialize", body: { supportsRunInTerminalRequest: true } });
            if (!ideServer) {
                ideServer = new IDEServer();
                await ideServer.ready;
            }
            this.send({ type: "event", event: "initialized" });

        } else if (message.command === "launch") {
            this.send({ type: "response", request_seq: message.seq, success: true, command: "launch" });
            
            const args = [this.config.compilerPath, "build", `-idePort=${ideServer.port}`, ...(this.config.path ? [this.config.path] : [])]

            const reqSeq = this._seq++;
            this.send({
                type: "request",
                seq: reqSeq,
                command: "runInTerminal",
                arguments: {
                    kind: "integrated",
                    title: "Brainfuck++ Project",
                    cwd: this.config.cwd,
                    args
                }
            });

        } else if (message.type === "response" && message.command === "runInTerminal") {
            if (!message.success) {
                vscode.window.showErrorMessage(`Failed to launch terminal: ${message.message}\n`);
                this.sendTerminated();
                return;
            }
            vscode.commands.executeCommand('workbench.action.terminal.focus');
            ideServer.once("exit", () => {
                this.sendTerminated();
            });

        } else if (message.command === "disconnect" || message.command === "terminate") {
            this.send({ type: "response", request_seq: message.seq, success: true, command: message.command });
            this.sendTerminated();
            ideServer.exit();

        } else {
            this.send({ type: "response", request_seq: message.seq, success: true, command: message.command, body: {} });
        }
    }

    send(message) {
        this._onDidSendMessage.fire(message);
    }

    sendTerminated() {
        if (this._terminated) return;
        this._terminated = true;
        this.send({ type: "event", event: "terminated" });
        this.send({ type: "event", event: "exited", body: { exitCode: 0 } });
    }

    dispose() {
    }
}

class IDEServer {
    constructor() {
        this.ready = new Promise((res, rej) => {
            this._internalEmitter = new EventEmitter();
            this._emitter = new EventEmitter();
            this._server = net.createServer((socket) => {
                socket.on("close", () => {
                    this._emitter.emit("exit")
                });
                this._internalEmitter.once("exit", () => socket.destroy());
            });
            this._server.listen(0, "127.0.0.1")
            this._server.on("listening", () => {
                this.port = this._server.address().port;
                res();
            });
        });
    }
    once(event, listener) {
        this._emitter.once(event, listener)
    }
    exit() {
        this._internalEmitter.emit("exit")
    }
}


module.exports = { BfppDebugConfigurationProvider, runCompiler, resolveCompilerPath, BfppDebugAdapterFactory };
