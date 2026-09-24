import {sqliteTable,text,integer,primaryKey,index} from 'drizzle-orm/sqlite-core';
export const sessions=sqliteTable('study_sessions',{
 id:text('id').primaryKey(),tokenHash:text('token_hash').notNull().unique(),version:text('version').notNull(),assignments:text('assignments').notNull(),createdAt:text('created_at').notNull(),demo:integer('demo').notNull().default(0),ipAddress:text('ip_address')
});
export const votes=sqliteTable('study_votes',{
 sessionId:text('session_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),trialId:text('trial_id').notNull(),dimension:text('dimension').notNull(),choice:text('choice').notNull(),reasons:text('reasons').notNull().default('[]'),comment:text('comment').notNull().default(''),elapsedMs:integer('elapsed_ms').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.sessionId,t.trialId,t.dimension]}),index('idx_votes_dimension').on(t.dimension)]);
