import { IAppCategory } from './types';

export const DEFAULT_IDLE_THRESHOLD_MINUTES = 1;
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
export const DEFAULT_RETENTION_DAYS = 365; // 1 year internal retention
export const DEFAULT_BATCH_SYNC_LIMIT = 100;
export const STALE_SESSION_HEARTBEAT_MULTIPLIER = 3;

export const DEFAULT_APP_CATEGORIES: IAppCategory[] = [
  {
    name: 'Development & Engineering',
    color: '#6366F1', // Indigo
    apps: ['code', 'vs code', 'visual studio', 'cursor', 'webstorm', 'intellij', 'pycharm', 'terminal', 'powershell', 'cmd', 'git', 'github desktop', 'postman']
  },
  {
    name: 'Design & Creative',
    color: '#EC4899', // Pink
    apps: ['figma', 'photoshop', 'illustrator', 'after effects', 'premiere pro', 'canva', 'blender', 'sketch', 'indesign', 'lightroom']
  },
  {
    name: 'Digital Marketing & SEO',
    color: '#F59E0B', // Amber
    apps: ['ahrefs', 'semrush', 'meta ads manager', 'google ads', 'analytics', 'search console', 'hubspot', 'mailchimp', 'hootsuite', 'buffer']
  },
  {
    name: 'Agency Communication',
    color: '#06B6D4', // Cyan
    apps: ['slack', 'teams', 'discord', 'zoom', 'google meet', 'outlook', 'thunderbird', 'telegram', 'whatsapp']
  },
  {
    name: 'Project Management & Docs',
    color: '#10B981', // Emerald
    apps: ['notion', 'clickup', 'jira', 'trello', 'asana', 'monday', 'linear', 'excel', 'word', 'sheets', 'docs']
  },
  {
    name: 'Browsing & Research',
    color: '#8B5CF6', // Violet
    apps: ['chrome', 'google chrome', 'firefox', 'msedge', 'edge', 'brave', 'safari', 'opera']
  }
];

export const STANDARD_APPLICATION_CATEGORIES = [
  'Development',
  'Design',
  'Communication',
  'Browsers',
  'Productivity',
  'Marketing',
  'Project Management',
  'File Management',
  'Media',
  'Other'
] as const;

export const DEFAULT_REGISTRY_APPLICATIONS = [
  // Development
  { name: 'Visual Studio Code', executableNames: ['code.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Cursor', executableNames: ['cursor.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Visual Studio', executableNames: ['devenv.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'IntelliJ IDEA', executableNames: ['idea64.exe', 'idea.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'WebStorm', executableNames: ['webstorm64.exe', 'webstorm.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Android Studio', executableNames: ['studio64.exe', 'studio.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'PyCharm', executableNames: ['pycharm64.exe', 'pycharm.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Git', executableNames: ['git.exe', 'git-bash.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'GitHub Desktop', executableNames: ['githubdesktop.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Antigravity IDE', executableNames: ['antigravity.exe', 'antigravity ide.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Windows Terminal', executableNames: ['windowsterminal.exe', 'powershell.exe', 'cmd.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Postman', executableNames: ['postman.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },
  { name: 'DBeaver', executableNames: ['dbeaver.exe'], category: 'Development', tracked: true, ignored: false, isSystemApp: false },

  // Design
  { name: 'Figma', executableNames: ['figma.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Adobe Photoshop', executableNames: ['photoshop.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Adobe Illustrator', executableNames: ['illustrator.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Adobe Premiere Pro', executableNames: ['premiere.exe', 'premierepro.exe', 'adobe premiere pro.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Adobe After Effects', executableNames: ['afterfx.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Canva', executableNames: ['canva.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Blender', executableNames: ['blender.exe'], category: 'Design', tracked: true, ignored: false, isSystemApp: false },

  // Communication
  { name: 'Slack', executableNames: ['slack.exe'], category: 'Communication', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Microsoft Teams', executableNames: ['teams.exe', 'ms-teams.exe'], category: 'Communication', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Discord', executableNames: ['discord.exe'], category: 'Communication', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Zoom', executableNames: ['zoom.exe'], category: 'Communication', tracked: true, ignored: false, isSystemApp: false },

  // Browsers
  { name: 'Google Chrome', executableNames: ['chrome.exe'], category: 'Browsers', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Microsoft Edge', executableNames: ['msedge.exe'], category: 'Browsers', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Mozilla Firefox', executableNames: ['firefox.exe'], category: 'Browsers', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Brave', executableNames: ['brave.exe'], category: 'Browsers', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Opera', executableNames: ['opera.exe'], category: 'Browsers', tracked: true, ignored: false, isSystemApp: false },

  // Productivity
  { name: 'Notion', executableNames: ['notion.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Microsoft Word', executableNames: ['winword.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Microsoft Excel', executableNames: ['excel.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Microsoft PowerPoint', executableNames: ['powerpnt.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Microsoft Outlook', executableNames: ['outlook.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Notepad', executableNames: ['notepad.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Notepad++', executableNames: ['notepad++.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Obsidian', executableNames: ['obsidian.exe'], category: 'Productivity', tracked: true, ignored: false, isSystemApp: false },

  // Project Management
  { name: 'Jira', executableNames: ['jira.exe'], category: 'Project Management', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Trello', executableNames: ['trello.exe'], category: 'Project Management', tracked: true, ignored: false, isSystemApp: false },
  { name: 'ClickUp', executableNames: ['clickup.exe'], category: 'Project Management', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Asana', executableNames: ['asana.exe'], category: 'Project Management', tracked: true, ignored: false, isSystemApp: false },

  // Marketing
  { name: 'Google Ads', executableNames: ['googleads.exe', 'google-ads.exe'], category: 'Marketing', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Google Analytics', executableNames: ['googleanalytics.exe'], category: 'Marketing', tracked: true, ignored: false, isSystemApp: false },
  { name: 'Meta Business Suite', executableNames: ['metabusiness.exe', 'meta business suite.exe'], category: 'Marketing', tracked: true, ignored: false, isSystemApp: false },

  // File Management
  { name: 'Windows File Explorer', executableNames: ['explorer.exe'], category: 'File Management', tracked: true, ignored: false, isSystemApp: false },
  { name: 'OneDrive', executableNames: ['onedrive.exe'], category: 'File Management', tracked: true, ignored: false, isSystemApp: false },

  // Media
  { name: 'Spotify', executableNames: ['spotify.exe', 'spotifylauncher.exe', 'spotify_cli.exe'], category: 'Media', tracked: false, ignored: true, isSystemApp: false },
  { name: 'VLC Media Player', executableNames: ['vlc.exe'], category: 'Media', tracked: false, ignored: true, isSystemApp: false },

  // Internal / System
  { name: 'HighP Agent', executableNames: ['highp agent.exe', 'highptelemetrynative.exe', 'electron.exe'], category: 'Other', tracked: false, ignored: true, isSystemApp: true }
];
