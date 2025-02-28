import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
	let chatPanel: vscode.WebviewPanel | undefined = undefined;
	let chatHistory: string[] = [];
	// Store gitignore patterns for caching
	let gitignorePatterns: Map<string, string[]> = new Map();

	let createChatCommand = vscode.commands.registerCommand('extension.createChat', () => {
		if (chatPanel) {
			chatPanel.reveal(vscode.ViewColumn.Beside);
		} else {
			chatPanel = vscode.window.createWebviewPanel(
				'chatSpace',
				'Chat Space',
				vscode.ViewColumn.Beside,
				{
					enableScripts: true,
					retainContextWhenHidden: true
				}
			);

			updateWebview();

			chatPanel.webview.onDidReceiveMessage(
				async (message) => {
					if (message.type === 'userInput') {
						const userInput = message.text;
						chatHistory.push(`User: ${userInput}`);

						if (userInput.trim().startsWith('/')) {
							const command = userInput.trim().substring(1).toLowerCase();
							let response = '';

							if (command === 'tab') {
								response = await handleTabCommand();
							} else if (command === 'file') {
								response = await handleFileCommand();
							}

							if (response) {
								chatHistory.push(`System: ${response}`);
							}
						}

						updateWebview();
					}
					else if (message.type === 'runCommand') {
						let response = '';

						if (message.command === 'tab') {
							response = await handleTabCommand();
						} else if (message.command === 'file') {
							response = await handleFileCommand();
						}

						chatHistory.push(`System: ${response}`);
						updateWebview();
					}
				},
				undefined,
				context.subscriptions
			);

			chatPanel.onDidDispose(
				() => {
					chatPanel = undefined;
					chatHistory = [];
					gitignorePatterns.clear();
				},
				null,
				context.subscriptions
			);
		}
	});

	context.subscriptions.push(createChatCommand);

	function updateWebview() {
		if (!chatPanel) { return; }

		const htmlContent = `
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Chat Space</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 0;
                        margin: 0;
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .chat-container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    .chat-history {
                        flex: 1;
                        overflow-y: auto;
                        padding: 16px;
                    }
                    .message {
                        margin-bottom: 10px;
                        padding: 8px 12px;
                        border-radius: 4px;
                        white-space: pre-wrap;
                    }
                    .user-message {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        align-self: flex-end;
                    }
                    .system-message {
                        background-color: var(--vscode-editor-selectionBackground);
                    }
                    .input-container {
                        padding: 16px;
                        border-top: 1px solid var(--vscode-editor-lineHighlightBorder);
                    }
                    textarea {
                        width: 100%;
                        padding: 8px;
                        resize: vertical;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        font-family: var(--vscode-font-family);
                    }
                    pre {
                        white-space: pre-wrap;
                        margin: 10px 0;
                        padding: 0;
                    }
                    .command-toolbar {
                        display: flex;
                        gap: 8px;
                        padding: 8px 16px;
                        border-bottom: 1px solid var(--vscode-editor-lineHighlightBorder);
                    }
                    .command-button {
                        padding: 6px 12px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                    }
                    .command-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .command-icon {
                        margin-right: 6px;
                    }
                    .tooltip {
                        position: relative;
                        display: inline-block;
                    }
                    .tooltip .tooltiptext {
                        visibility: hidden;
                        width: 200px;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        text-align: center;
                        border-radius: 6px;
                        border: 1px solid var(--vscode-input-border);
                        padding: 5px;
                        position: absolute;
                        z-index: 1;
                        bottom: 125%;
                        opacity: 0;
                        transition: opacity 0.3s;
                    }
                    .tooltip:hover .tooltiptext {
                        visibility: visible;
                        opacity: 1;
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="chat-history" id="chatHistory">
                        ${chatHistory.map(msg => {
			const isUser = msg.startsWith('User: ');
			const content = msg.substring(msg.indexOf(': ') + 2);

			return `<div class="message ${isUser ? 'user-message' : 'system-message'}"><pre>${escapeHtml(content)}</pre></div>`;
		}).join('')}
                    </div>
                    <div class="command-toolbar">
                        <div class="tooltip">
                            <button class="command-button" id="btnTab">
                                <span class="command-icon">📁</span> /tab
                            </button>
                            <span class="tooltiptext">Reads and outputs all tabs of files currently open in VS Code. You can also type "/tab" in the input field.</span>
                        </div>
                        <div class="tooltip">
                            <button class="command-button" id="btnFile">
                                <span class="command-icon">📄</span> /file
                            </button>
                            <span class="tooltiptext">Searches for files under the project root in VS Code, allows file selection, and outputs the selected file. You can also type "/file" in the input field.</span>
                        </div>
                    </div>
                    <div class="input-container">
                        <textarea id="userInput" placeholder="Type a message or command (/tab, /file)..." rows="4"></textarea>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const chatHistory = document.getElementById('chatHistory');
                    const userInput = document.getElementById('userInput');
                    const btnTab = document.getElementById('btnTab');
                    const btnFile = document.getElementById('btnFile');

                    function scrollToBottom() {
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    }
                    
                    scrollToBottom();

                    userInput.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            const text = userInput.value.trim();
                            if (text) {
                                vscode.postMessage({
                                    type: 'userInput',
                                    text: text
                                });
                                userInput.value = '';
                            }
                        }
                    });
                    
                    btnTab.addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'runCommand',
                            command: 'tab'
                        });
                    });
                    
                    btnFile.addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'runCommand',
                            command: 'file'
                        });
                    });
                </script>
            </body>
            </html>
        `;

		chatPanel.webview.html = htmlContent;
	}

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	async function handleTabCommand(): Promise<string> {
		const tabs = vscode.window.tabGroups.all
			.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof vscode.TabInputText)
			.map(tab => (tab.input as vscode.TabInputText).uri);

		if (tabs.length === 0) {
			return 'None of the tabs are open.';
		}

		let result = '';

		for (const tabUri of tabs) {
			try {
				const document = await vscode.workspace.openTextDocument(tabUri);
				const relativePath = getRelativePath(tabUri);
				const content = document.getText();

				result += `\`\`\`${relativePath}\n${content}\n\`\`\`\n\n`;
			} catch (error) {
				console.error('Failed to read tab content:', error);
			}
		}

		return result.trim();
	}

	async function handleFileCommand(): Promise<string> {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return 'No workspace is opened.';
		}

		const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

		// Find all .gitignore files first and build ignore patterns
		await findAllGitignoreFiles(rootPath);

		const files = await findFiles(rootPath);

		if (files.length === 0) {
			return 'Files not found in the workspace.';
		}

		const relativeFiles = files.map(file => {
			return path.relative(rootPath, file);
		});

		const selectedFile = await vscode.window.showQuickPick(relativeFiles, {
			placeHolder: 'Select a file to display its content'
		});

		if (!selectedFile) {
			return 'Canceled.';
		}

		try {
			const filePath = path.join(rootPath, selectedFile);
			const content = fs.readFileSync(filePath, 'utf8');
			return `\`\`\`${selectedFile}\n${content}\n\`\`\``;
		} catch (error) {
			console.error('Failed to read file content:', error);
			return `Failed to read file content: ${error}`;
		}
	}

	async function findAllGitignoreFiles(dirPath: string): Promise<void> {
		try {
			// Clear previous cache if rerunning
			gitignorePatterns.clear();

			// Find and process all .gitignore files recursively
			await processGitignoreFiles(dirPath);
		} catch (error) {
			console.error('Error processing gitignore files:', error);
		}
	}

	async function processGitignoreFiles(dirPath: string): Promise<void> {
		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });

			// Check if the current directory has a .gitignore file
			const gitignorePath = path.join(dirPath, '.gitignore');
			if (fs.existsSync(gitignorePath)) {
				const content = fs.readFileSync(gitignorePath, 'utf8');
				const patterns = parseGitignore(content);
				gitignorePatterns.set(dirPath, patterns);
			}

			// Process subdirectories
			for (const entry of entries) {
				if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
					const subdirPath = path.join(dirPath, entry.name);
					await processGitignoreFiles(subdirPath);
				}
			}
		} catch (error) {
			console.error(`Error processing directory ${dirPath}:`, error);
		}
	}

	function parseGitignore(content: string): string[] {
		return content.split('\n')
			.map(line => line.trim())
			.filter(line => line && !line.startsWith('#'));
	}

	function isIgnoredByGitignore(filePath: string, rootPath: string): boolean {
		const relativePath = path.relative(rootPath, filePath);
		const fileDir = path.dirname(filePath);

		// Check all directories from the file location up to the root
		let currentDir = fileDir;
		while (currentDir.startsWith(rootPath)) {
			if (gitignorePatterns.has(currentDir)) {
				const patterns = gitignorePatterns.get(currentDir)!;

				for (const pattern of patterns) {
					// Handle simple glob patterns
					if (isMatchPattern(relativePath, pattern)) {
						return true;
					}
				}
			}

			// Move up one directory
			const parentDir = path.dirname(currentDir);
			if (parentDir === currentDir) break; // We've reached the root
			currentDir = parentDir;
		}

		return false;
	}

	function isMatchPattern(filePath: string, pattern: string): boolean {
		// Convert gitignore pattern to regex
		// This is a simplified version and doesn't handle all gitignore syntax
		const regexPattern = pattern
			.replace(/\./g, '\\.')     // Escape dots
			.replace(/\*/g, '.*')      // Convert * to regex equivalent
			.replace(/\?/g, '.')       // Convert ? to regex equivalent
			.replace(/\//g, '\\/');    // Escape slashes

		const regex = new RegExp(`^${regexPattern}$|^${regexPattern}\\/|\\/${regexPattern}$|\\/${regexPattern}\\/`);
		return regex.test(filePath);
	}

	async function findFiles(dirPath: string): Promise<string[]> {
		const files: string[] = [];
		const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;

		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);
				const relativePath = path.relative(rootPath, fullPath);

				// Skip dot files and node_modules by default
				if (entry.name.startsWith('.') || entry.name === 'node_modules') {
					continue;
				}

				// Check if file is ignored by any .gitignore
				if (isIgnoredByGitignore(fullPath, rootPath)) {
					continue;
				}

				if (entry.isDirectory()) {
					const subFiles = await findFiles(fullPath);
					files.push(...subFiles);
				} else {
					files.push(fullPath);
				}
			}
		} catch (error) {
			console.error(`Error reading directory ${dirPath}:`, error);
		}

		return files;
	}

	function getRelativePath(uri: vscode.Uri): string {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return uri.fsPath;
		}

		const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
		return path.relative(rootPath, uri.fsPath);
	}
}

export function deactivate() { }