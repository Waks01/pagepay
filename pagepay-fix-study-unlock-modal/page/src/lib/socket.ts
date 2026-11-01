/**
 * Socket.IO client for real-time updates.
 * Handles: referral stats, wallet balance, task updates, notifications.
 */
import { io, Socket } from 'socket.io-client';
import { API_URL } from '@/src/shared/api/client';

let socket: Socket | null = null;

export function connectSocket(userId: number) {
  if (socket?.connected) return socket;

  socket = io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
  });

  socket.on('connect', () => {
    console.log('Socket connected');
    socket?.emit('authenticate', { user_id: userId });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

// Event listeners
export function onReferralUpdate(callback: (stats: any) => void) {
  socket?.on('referral:update', callback);
}

export function onWalletUpdate(callback: (data: { balance: number }) => void) {
  socket?.on('wallet:update', callback);
}

export function onTaskUpdate(callback: (data: { task_id: number; status: string }) => void) {
  socket?.on('task:update', callback);
}

export function onNotification(callback: (notification: any) => void) {
  socket?.on('notification', callback);
}

// Clean up listeners
export function offReferralUpdate(callback: (stats: any) => void) {
  socket?.off('referral:update', callback);
}

export function offWalletUpdate(callback: (data: { balance: number }) => void) {
  socket?.off('wallet:update', callback);
}

export function offTaskUpdate(callback: (data: { task_id: number; status: string }) => void) {
  socket?.off('task:update', callback);
}

export function offNotification(callback: (notification: any) => void) {
  socket?.off('notification', callback);
}
