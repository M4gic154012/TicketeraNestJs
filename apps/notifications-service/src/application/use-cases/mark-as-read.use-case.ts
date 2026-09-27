import { Injectable } from '@nestjs/common';
import { ApplicationService } from '@ticketera/patterns';
import { NotificationsRepository } from '../../infrastructure/repositories';

export interface MarkAsReadCommand {
  recipientId: string;
  notificationIds: string[];
}

@Injectable()
export class MarkAsReadUseCase extends ApplicationService<MarkAsReadCommand, { updated: number }> {
  constructor(private readonly notifications: NotificationsRepository) {
    super();
  }

  async execute(command: MarkAsReadCommand): Promise<{ updated: number }> {
    const updated = await this.notifications.markAsRead(
      command.recipientId,
      command.notificationIds.slice(0, 200),
    );
    return { updated };
  }
}
