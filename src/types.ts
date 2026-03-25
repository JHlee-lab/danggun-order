export interface Order {
  id?: string;
  date?: string;
  item: string;
  name: string;
  address?: string;
  phone?: string;
  amount?: number;
  status: '대기' | '완료' | 'A/S';
  capturedImageUrl?: string;
  userId: string;
  createdAt: string;
}

export interface SavedFilter {
  id?: string;
  userId: string;
  name: string;
  period: 'all' | 'year' | 'month' | 'lastMonth' | 'week' | 'yesterday';
  status: 'all' | '대기' | '완료' | 'A/S';
  searchText: string;
  createdAt: string;
}
