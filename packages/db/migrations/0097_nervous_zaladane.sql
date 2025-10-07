ALTER TABLE "paused_workflow_executions" ADD COLUMN "approval_token" text;--> statement-breakpoint
ALTER TABLE "paused_workflow_executions" ADD COLUMN "approval_used" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "paused_executions_approval_token_idx" ON "paused_workflow_executions" USING btree ("approval_token");--> statement-breakpoint
ALTER TABLE "paused_workflow_executions" ADD CONSTRAINT "paused_workflow_executions_approval_token_unique" UNIQUE("approval_token");