import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';

// Define the exact shape of our Poll based on the backend schema
export interface Poll {
  _id: string;
  title: string;
  isAnonymous: boolean;
  expiresAt: string;
  isPublished: boolean;
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
  closePoll: (pollId: string) => Promise<void>;
}

export const useCreatorStore = create<CreatorState>((set, get) => ({
  polls:[],
  isLoading: false,
  error: null,

  fetchPolls: async () => {
    set({ isLoading: true, error: null });
    try {
      // Mock creatorId until Auth is built
      const res = await apiClient.get('/polls?creatorId=mock-creator-id-123');
      set({ polls: res.data.data, isLoading: false }); // Assuming your ApiResponse puts payload in 'data'
    } catch (err: any) {
      set({ 
        error: err.response?.data?.message || 'Failed to fetch polls', 
        isLoading: false 
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
      set((state) => ({ 
        polls:[newPoll, ...state.polls], 
        isLoading: false 
      }));
      
      return newPoll;
    } catch (err: any) {
      set({ 
        error: err.response?.data?.message || 'Failed to create poll', 
        isLoading: false 
      });
      throw err;
    }
  },

  closePoll: async (pollId) => {
    try {
      await apiClient.post(`/polls/${pollId}/close`);
      // Update the specific poll in our local state to show it as closed
      set((state) => ({
        polls: state.polls.map(p => 
          p._id === pollId ? { ...p, expiresAt: new Date().toISOString() } : p
        )
      }));
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Failed to close poll' });
    }
  }
}));