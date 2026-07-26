CREATE TABLE `engine_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`config` json NOT NULL,
	`isPublic` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `engine_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`configId` int,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`format` enum('wav','mp3') NOT NULL DEFAULT 'wav',
	`duration` int NOT NULL DEFAULT 10,
	`fileUrl` text,
	`fileKey` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `export_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `upvotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`configId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `upvotes_id` PRIMARY KEY(`id`)
);
