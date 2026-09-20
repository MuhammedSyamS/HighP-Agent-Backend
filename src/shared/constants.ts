import { IAppCategory } from './types';

export const DEFAULT_IDLE_THRESHOLD_MINUTES = 5;
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
