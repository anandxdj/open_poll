import { create } from 'zustand';
import axios from 'axios';

import { apiClient } from '@/lib/api-client';

function axiosMessage(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const data = err.response?.data as { message?: string } | undefined;
  return typeof data?.message === 'string' ? data.message : undefined;
}

// Define the exact shape of our Poll based on the backend schema
export interface Poll {
  _id: string;
  title: string;
  isAnonymous: boolean;
  expiresAt: string;
  isPublished: boolean;
  isClosed?: boolean;
  isResultsPublished?: boolean;
  questions: {
    _id?: string;
    text: string;
    options: string[];
    isMandatory: boolean;
  }[];
  createdAt: string;
}

interface CreatorState {
  polls: Poll[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchPolls: () => Promise<void>;
  createPoll: (pollData: Partial<Poll>) => Promise<Poll>;
  updatePoll: (pollId: string, pollData: Partial<Poll>) => Promise<Poll>;
  closePoll: (pollId: string) => Promise<void>;
  publishResults: (pollId: string) => Promise<void>;
  deletePoll: (pollId: string) => Promise<void>;
}

export const useCreatorStore = create<CreatorState>((set) => ({
  polls:[],
  isLoading: false,
  error: null,

  fetchPolls: async () => {
    set({ isLoading: true, error: null });
    try {
      // Mock creatorId until Auth is built
      const res = await apiClient.get('/polls?creatorId=mock-creator-id-123');
      const list = res.data?.data;
      set({ polls: Array.isArray(list) ? list : [], isLoading: false });
    } catch (err: unknown) {
      set({
        error: axiosMessage(err) ?? 'Failed to fetch polls',
        isLoading: false,
      });
    }
  },

  createPoll: async (pollData) => {
    set({ isLoading: true, error: null });
    try {
      const payload = {
        ...pollData,
        creatorId: 'mock-creator-id-123'
      };
      const res = await apiClient.post('/polls', payload);
      const newPoll = res.data.data;
      
      // Update local state instantly so the UI feels fast
      set((state) => {
        const exists = state.polls.some((p) => p._id === newPoll._id);
        if (exists) return { isLoading: false };
        return { 
          polls:[newPoll, ...state.polls], 
          isLoading: false 
        };
      });
      
      return newPoll;
    } catch (err: unknown) {
      set({
        error: axiosMessage(err) ?? 'Failed to create poll',
        isLoading: false,
      });
      throw err;
    }
  },

  updatePoll: async (pollId, pollData) => {
    set({ isLoading: true, error: null });
    try {
      const res = await apiClient.patch(`/polls/${pollId}`, pollData);
      const updatedPoll = res.data.data;
      
      set((state) => ({ 
        polls: state.polls.map(p => p._id === pollId ? updatedPoll : p),
        isLoading: false 
      }));
      
      return updatedPoll;
    } catch (err: unknown) {
      set({
        error: axiosMessage(err) ?? 'Failed to update poll',
        isLoading: false,
      });
      throw err;
    }
  },

  closePoll: async (pollId) => {
    try {
      const res = await apiClient.post(`/polls/${pollId}/close`);
      const closedPoll = res.data.data;
      
      set((state) => ({
        polls: state.polls.map(p => 
          p._id === pollId ? closedPoll : p
        )
      }));
    } catch (err: unknown) {
      set({ error: axiosMessage(err) ?? 'Failed to close poll' });
    }
  },

  publishResults: async (pollId) => {
    try {
      const res = await apiClient.post(`/polls/${pollId}/publish-results`);
      const updatedPoll = res.data.data;
      
      set((state) => ({
        polls: state.polls.map(p => 
          p._id === pollId ? updatedPoll : p
        )
      }));
    } catch (err: unknown) {
      set({ error: axiosMessage(err) ?? 'Failed to publish results' });
      throw err;
    }
  },

  deletePoll: async (pollId) => {
    try {
      await apiClient.delete(`/polls/${pollId}`);
      set((state) => ({
        polls: state.polls.filter(p => p._id !== pollId)
      }));
    } catch (err: unknown) {
      set({ error: axiosMessage(err) ?? 'Failed to delete poll' });
      throw err;
    }
  }
}));