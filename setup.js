#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const CLAUDE_CONFIG_PATHS = {
  darwin: join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  win32: join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
  linux: join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
};

function getClaudeConfigPath() {
  return CLAUDE_CONFIG_PATHS[process.platform] || CLAUDE_CONFIG_PATHS.linux;
}

function getCurrentProjectPath() {
  return resolve(process.cwd(), 'dist', 'index.js');
}

function setupClaudeDesktop() {
  const configPath = getClaudeConfigPath();
  const projectPath = getCurrentProjectPath();
  
  console.log('🔧 Setting up Claude Memory Server...');
  console.log(`📁 Project path: ${projectPath}`);
  console.log(`⚙️  Config path: ${configPath}`);
  
  // Check if project is built
  if (!existsSync(projectPath)) {
    console.error('❌ Project not built! Run "bun run build" first.');
    process.exit(1);
  }
  
  let config = {};
  
  // Read existing config if it exists
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
      console.log('📖 Found existing Claude config');
    } catch (error) {
      console.log('⚠️  Could not parse existing config, creating new one');
      config = {};
    }
  } else {
    console.log('📝 Creating new Claude config');
  }
  
  // Ensure mcpServers object exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  
  // Add our memory server
  config.mcpServers['claude-memory'] = {
    command: 'node',
    args: [projectPath],
    env: {}
  };
  
  // Write the updated config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ Claude Desktop config updated successfully!');
    console.log('');
    console.log('🔄 Please restart Claude Desktop for changes to take effect.');
    console.log('');
    console.log('🎉 You can now use memory tools in Claude Desktop:');
    console.log('   - store_memory: Store important information');
    console.log('   - search_memory: Find stored memories');
    console.log('   - get_memory_stats: View memory statistics');
    console.log('   - And more!');
  } catch (error) {
    console.error('❌ Failed to write config:', error.message);
    console.log('');
    console.log('📋 Manual setup required. Add this to your Claude config:');
    console.log(JSON.stringify({
      mcpServers: {
        'claude-memory': {
          command: 'node',
          args: [projectPath],
          env: {}
        }
      }
    }, null, 2));
  }
}

setupClaudeDesktop();