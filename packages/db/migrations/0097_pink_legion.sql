CREATE TABLE "paused_workflow_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"user_id" text NOT NULL,
	"paused_at" timestamp NOT NULL,
	"execution_context" jsonb NOT NULL,
	"workflow_state" jsonb NOT NULL,
	"environment_variables" jsonb NOT NULL,
	"workflow_input" jsonb,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"approval_token" text,
	"approval_used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paused_workflow_executions_approval_token_unique" UNIQUE("approval_token")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "copilot_enabled_models" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "paused_workflow_executions" ADD CONSTRAINT "paused_workflow_executions_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paused_workflow_executions" ADD CONSTRAINT "paused_workflow_executions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paused_executions_workflow_id_idx" ON "paused_workflow_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "paused_executions_execution_id_idx" ON "paused_workflow_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "paused_executions_user_id_idx" ON "paused_workflow_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paused_executions_paused_at_idx" ON "paused_workflow_executions" USING btree ("paused_at");--> statement-breakpoint
CREATE INDEX "paused_executions_approval_token_idx" ON "paused_workflow_executions" USING btree ("approval_token");--> statement-breakpoint
CREATE UNIQUE INDEX "paused_executions_execution_id_unique" ON "paused_workflow_executions" USING btree ("execution_id");