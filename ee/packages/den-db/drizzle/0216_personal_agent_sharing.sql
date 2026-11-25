CREATE TABLE `personal_agent_chat` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`agent_id` varchar(64) NOT NULL,
	`member_id` varchar(64) NOT NULL,
	`workspace_id` varchar(240) NOT NULL,
	`session_id` varchar(240) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_chat_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_agent_chat_member_workspace` UNIQUE(`agent_id`,`member_id`,`workspace_id`)
);
--> statement-breakpoint
CREATE TABLE `personal_agent_event` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`agent_id` varchar(64),
	`actor_member_id` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`detail` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_event_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personal_agent_org_policy` (
	`organization_id` varchar(64) NOT NULL,
	`tool_policy` json NOT NULL,
	`monthly_budget_micros` bigint unsigned,
	`updated_by_member_id` varchar(64) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_org_policy_organization_id` PRIMARY KEY(`organization_id`)
);
--> statement-breakpoint
CREATE TABLE `personal_agent_request` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`agent_id` varchar(64) NOT NULL,
	`kind` enum('tool','change') NOT NULL,
	`status` enum('pending','denied','allowed_once','always_allowed','approved','used') NOT NULL DEFAULT 'pending',
	`requested_by_member_id` varchar(64) NOT NULL,
	`run_id` varchar(64),
	`used_by_run_id` varchar(64),
	`connection_id` varchar(160),
	`connection_name` varchar(160),
	`tool_name` varchar(128),
	`tool_title` varchar(240),
	`summary` varchar(500),
	`change` json,
	`decided_by_member_id` varchar(64),
	`decided_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_request_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personal_agent_share` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`agent_id` varchar(64) NOT NULL,
	`member_id` varchar(64) NOT NULL,
	`role` enum('manager','collaborator') NOT NULL,
	`created_by_member_id` varchar(64) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_share_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_agent_share_member` UNIQUE(`agent_id`,`member_id`)
);
--> statement-breakpoint
ALTER TABLE `automation_run` ADD `acting_member_id` varchar(64);--> statement-breakpoint
ALTER TABLE `personal_agent` ADD `paused_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `personal_agent` ADD `paused_by_member_id` varchar(64);--> statement-breakpoint
ALTER TABLE `personal_agent` ADD `admin_monthly_budget_micros` bigint unsigned;--> statement-breakpoint
ALTER TABLE `personal_agent` ADD `created_by_member_id` varchar(64);--> statement-breakpoint
ALTER TABLE `personal_agent` ADD `idempotency_key` varchar(128);--> statement-breakpoint
ALTER TABLE `personal_agent` ADD CONSTRAINT `personal_agent_idempotency` UNIQUE(`organization_id`,`created_by_member_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `personal_agent_event_org_created` ON `personal_agent_event` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `personal_agent_event_agent` ON `personal_agent_event` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `personal_agent_request_agent_status` ON `personal_agent_request` (`agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `personal_agent_share_org_member` ON `personal_agent_share` (`organization_id`,`member_id`);