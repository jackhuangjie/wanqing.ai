import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const dailyUsage = sqliteTable('daily_usage', {
  day: text('day').notNull(),
  viewer: text('viewer').notNull(),
  attempts: integer('attempts').notNull(),
}, table => [primaryKey({ columns: [table.day, table.viewer] })]);
