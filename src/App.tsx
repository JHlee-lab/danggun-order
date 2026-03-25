/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  serverTimestamp,
  getDocFromServer,
  getDoc,
  setDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Order, SavedFilter } from './types';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Plus, 
  Upload, 
  Trash2, 
  Save, 
  LogOut, 
  FileText, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  Image as ImageIcon,
  Search,
  Download,
  ArrowUpDown,
  Filter,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Check,
  Bookmark,
  BookmarkPlus,
  X,
  Copy,
  User as UserIcon,
  MessageSquare,
  Bell,
  Sparkles,
  RefreshCw,
  Settings
} from 'lucide-react';
import { cn } from './lib/utils';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

const GENAI_MODEL = "gemini-3-flash-preview";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedOrders, setExtractedOrders] = useState<(Partial<Order> & { tempId: string })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [periodFilter, setPeriodFilter] = useState<'all' | 'year' | 'month' | 'lastMonth' | 'week' | 'yesterday'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | '대기' | '완료' | 'A/S'>('all');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [showSingleDeleteConfirm, setShowSingleDeleteConfirm] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Order; direction: 'asc' | 'desc' } | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [isSavingFilter, setIsSavingFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyCustomerName, setHistoryCustomerName] = useState<string | null>(null);
  const [historyCustomerPhone, setHistoryCustomerPhone] = useState<string | null>(null);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [replyOrder, setReplyOrder] = useState<Order | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [aiTips, setAiTips] = useState<string | null>(null);
  const [isGeneratingTips, setIsGeneratingTips] = useState(false);
  const [storeName, setStoreName] = useState<string>('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const orderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(order => {
      const name = order.name?.trim();
      const phone = order.phone?.replace(/\D/g, '');
      
      if (name) {
        counts[`name_${name}`] = (counts[`name_${name}`] || 0) + 1;
      }
      if (phone && phone.length >= 8) {
        counts[`phone_${phone}`] = (counts[`phone_${phone}`] || 0) + 1;
      }
    });
    return counts;
  }, [orders]);

  const getRepeatCount = (name?: string, phone?: string) => {
    if (!name && !phone) return 0;
    
    const nameKey = name ? `name_${name.trim()}` : null;
    const phoneKey = phone ? `phone_${phone.replace(/\D/g, '')}` : null;
    
    const nameCount = nameKey ? (orderCounts[nameKey] || 0) : 0;
    const phoneCount = (phoneKey && phoneKey.length >= 8) ? (orderCounts[phoneKey] || 0) : 0;
    
    return Math.max(nameCount, phoneCount);
  };

  // Auth listener
  useEffect(() => {
    document.title = "당근 주문 관리";
    if (isDemoMode) {
      setUser({
        uid: 'demo-user',
        displayName: '데모 사용자',
        email: 'demo@example.com',
        photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo'
      } as User);
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [isDemoMode]);

  // Firestore listener (Orders)
  useEffect(() => {
    if (isDemoMode) {
      const saved = localStorage.getItem('demo_orders');
      if (saved) setOrders(JSON.parse(saved));
      return;
    }
    if (!user) {
      setOrders([]);
      return;
    }

    const q = query(
      collection(db, 'orders'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Order[];
      setOrders(docs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'orders');
    });

    return () => unsubscribe();
  }, [user, isDemoMode]);

  // Saved Filters listener
  useEffect(() => {
    if (isDemoMode) {
      const saved = localStorage.getItem('demo_filters');
      if (saved) setSavedFilters(JSON.parse(saved));
      return;
    }
    if (!user) {
      setSavedFilters([]);
      return;
    }

    const q = query(
      collection(db, 'savedFilters'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedFilter[];
      setSavedFilters(docs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'savedFilters');
    });

    return () => unsubscribe();
  }, [user, isDemoMode]);

  // Load Store Name
  useEffect(() => {
    if (isDemoMode) {
      const saved = localStorage.getItem('store_name');
      if (saved) setStoreName(saved);
    } else if (user) {
      getDoc(doc(db, 'users', user.uid)).then(docSnap => {
        if (docSnap.exists() && docSnap.data().storeName) {
          setStoreName(docSnap.data().storeName);
        }
      });
    }
  }, [user, isDemoMode]);

  // Test connection
  useEffect(() => {
    if (isDemoMode) return;
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, [isDemoMode]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
      setError("로그인에 실패했습니다.");
    }
  };

  const handleLogout = () => {
    if (isDemoMode) {
      setIsDemoMode(false);
      setUser(null);
    } else {
      signOut(auth);
    }
  };

  const saveCurrentFilter = async () => {
    if (!user || !newFilterName.trim()) return;
    
    setIsSavingFilter(true);
    try {
      const filterData = {
        userId: user.uid,
        name: newFilterName.trim(),
        period: periodFilter,
        status: statusFilter,
        searchText: filterText,
        createdAt: new Date().toISOString()
      };
      
      if (isDemoMode) {
        const newFilters = [{ id: Math.random().toString(36).substring(7), ...filterData }, ...savedFilters];
        setSavedFilters(newFilters);
        localStorage.setItem('demo_filters', JSON.stringify(newFilters));
      } else {
        await addDoc(collection(db, 'savedFilters'), filterData);
      }
      setNewFilterName('');
      setShowSaveFilterModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'savedFilters');
    } finally {
      setIsSavingFilter(false);
    }
  };

  const applySavedFilter = (filter: SavedFilter) => {
    setPeriodFilter(filter.period);
    setStatusFilter(filter.status);
    setFilterText(filter.searchText);
  };

  const deleteSavedFilter = async (id: string) => {
    try {
      if (isDemoMode) {
        const newFilters = savedFilters.filter(f => f.id !== id);
        setSavedFilters(newFilters);
        localStorage.setItem('demo_filters', JSON.stringify(newFilters));
      } else {
        await deleteDoc(doc(db, 'savedFilters', id));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'savedFilters');
    }
  };

  const addManualOrder = () => {
    const newOrder = {
      tempId: Math.random().toString(36).substring(7),
      date: format(new Date(), 'yyyy-MM-dd'),
      item: '',
      name: '',
      address: '',
      phone: '',
      amount: 0,
      status: '대기' as const
    };
    setExtractedOrders(prev => [newOrder, ...prev]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsAnalyzing(true);
    setError(null);

    const processFile = async (file: File) => {
      return new Promise<void>((resolve, reject) => {
        const reader = new FileReader();
        const fallbackDate = format(new Date(file.lastModified), 'yyyy-MM-dd');
        
        reader.onloadend = async () => {
          try {
            const base64Data = (reader.result as string).split(',')[1];
            await analyzeImage(base64Data, fallbackDate);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    };

    try {
      // Process files sequentially to avoid rate limits and keep UI clean
      for (let i = 0; i < files.length; i++) {
        await processFile(files[i]);
      }
    } catch (err) {
      console.error("File upload error:", err);
      setError("이미지를 읽거나 분석하는 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const formatPhoneNumber = (phone: string | undefined): string => {
    if (!phone) return '';
    // Strip everything except digits
    const cleaned = phone.replace(/\D/g, '');
    
    // Handle 01012345678 or 1012345678
    let target = cleaned;
    if (target.length === 10 && target.startsWith('10')) {
      target = '0' + target;
    }

    if (target.length === 11) {
      return `${target.slice(0, 3)}-${target.slice(3, 7)}-${target.slice(7)}`;
    }
    if (target.length === 10) {
      return `${target.slice(0, 3)}-${target.slice(3, 6)}-${target.slice(6)}`;
    }
    
    // If it doesn't match standard lengths, just return as is but try to format if possible
    return phone;
  };

  const analyzeImage = async (base64Data: string, fallbackDate: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: GENAI_MODEL,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: base64Data,
                },
              },
              {
                text: `이 이미지는 당근마켓 채팅 캡쳐입니다. 여기서 주문 정보를 추출해서 JSON 형식으로 응답해줘.
                필드: date (날짜), item (품목), name (이름), address (주소), phone (연락처), amount (금액).
                금액은 숫자만 추출해줘. 날짜는 YYYY-MM-DD 형식으로 변환해줘.
                연락처(phone)는 반드시 010-0000-0000 형식으로 통일해서 추출해줘.
                만약 이미지 텍스트에서 날짜를 찾을 수 없다면, 기본값으로 "${fallbackDate}"를 사용해줘.
                찾을 수 없는 정보는 null로 표시해줘.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING, description: "주문 날짜 (YYYY-MM-DD)" },
              item: { type: Type.STRING, description: "품목" },
              name: { type: Type.STRING, description: "구매자 이름" },
              address: { type: Type.STRING, description: "배송 주소" },
              phone: { type: Type.STRING, description: "연락처 (010-0000-0000)" },
              amount: { type: Type.NUMBER, description: "구매 금액" },
            },
          },
        },
      });

      const result = JSON.parse(response.text || "{}");
      
      // Check if any meaningful information was extracted
      // We consider it a failure if all major fields are missing or null
      const hasInfo = result && (
        (result.name && result.name !== 'null') || 
        (result.item && result.item !== 'null') || 
        (result.address && result.address !== 'null') || 
        (result.phone && result.phone !== 'null') || 
        (result.amount && result.amount !== 0)
      );
      
      if (!hasInfo) {
        setError("이미지에서 주문 정보를 추출하지 못했습니다. 다른 이미지를 시도하거나 정보를 직접 입력해 주세요.");
        return;
      }

      const newExtractedOrder = {
        ...result,
        phone: formatPhoneNumber(result.phone),
        tempId: Math.random().toString(36).substring(7),
        status: '대기'
      };
      setExtractedOrders(prev => [...prev, newExtractedOrder]);
    } catch (err) {
      console.error("AI Analysis error:", err);
      throw err;
    }
  };

  const saveOrder = async (tempId: string) => {
    if (!user) return;
    const orderToSave = extractedOrders.find(o => o.tempId === tempId);
    if (!orderToSave) return;

    try {
      const newOrderData = {
        date: orderToSave.date || format(new Date(), 'yyyy-MM-dd'),
        item: orderToSave.item || '알 수 없는 품목',
        name: orderToSave.name || '알 수 없는 이름',
        address: orderToSave.address || '',
        phone: formatPhoneNumber(orderToSave.phone),
        amount: orderToSave.amount || 0,
        status: '대기' as const,
        userId: user.uid,
        createdAt: new Date().toISOString(),
      };

      if (isDemoMode) {
        const newOrdersList = [{ id: Math.random().toString(36).substring(7), ...newOrderData }, ...orders];
        setOrders(newOrdersList);
        localStorage.setItem('demo_orders', JSON.stringify(newOrdersList));
      } else {
        await addDoc(collection(db, 'orders'), newOrderData);
      }
      setExtractedOrders(prev => prev.filter(o => o.tempId !== tempId));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'orders');
    }
  };

  const saveAllOrders = async () => {
    if (!user || extractedOrders.length === 0) return;
    
    setIsAnalyzing(true);
    try {
      const newOrdersToPush = [];
      for (const order of extractedOrders) {
        const newOrderData = {
          date: order.date || format(new Date(), 'yyyy-MM-dd'),
          item: order.item || '알 수 없는 품목',
          name: order.name || '알 수 없는 이름',
          address: order.address || '',
          phone: formatPhoneNumber(order.phone),
          amount: order.amount || 0,
          status: '대기' as const,
          userId: user.uid,
          createdAt: new Date().toISOString(),
        };
        
        if (isDemoMode) {
          newOrdersToPush.push({ id: Math.random().toString(36).substring(7), ...newOrderData });
        } else {
          await addDoc(collection(db, 'orders'), newOrderData);
        }
      }
      
      if (isDemoMode) {
        const newOrdersList = [...newOrdersToPush, ...orders];
        setOrders(newOrdersList);
        localStorage.setItem('demo_orders', JSON.stringify(newOrdersList));
      }
      
      setExtractedOrders([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'orders');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const removeExtractedOrder = (tempId: string) => {
    setExtractedOrders(prev => prev.filter(o => o.tempId !== tempId));
  };

  const deleteOrder = (id: string) => {
    setOrderToDelete(id);
    setShowSingleDeleteConfirm(true);
  };

  const confirmDeleteOrder = async () => {
    if (!orderToDelete) return;
    try {
      if (isDemoMode) {
        const newOrders = orders.filter(o => o.id !== orderToDelete);
        setOrders(newOrders);
        localStorage.setItem('demo_orders', JSON.stringify(newOrders));
      } else {
        await deleteDoc(doc(db, 'orders', orderToDelete));
      }
      setSelectedOrderIds(prev => prev.filter(oid => oid !== orderToDelete));
      setShowSingleDeleteConfirm(false);
      setOrderToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `orders/${orderToDelete}`);
    }
  };

  const deleteSelectedOrders = async () => {
    if (selectedOrderIds.length === 0) return;
    
    setIsDeleting(true);
    try {
      if (isDemoMode) {
        const newOrders = orders.filter(o => !selectedOrderIds.includes(o.id!));
        setOrders(newOrders);
        localStorage.setItem('demo_orders', JSON.stringify(newOrders));
      } else {
        for (const id of selectedOrderIds) {
          await deleteDoc(doc(db, 'orders', id));
        }
      }
      setSelectedOrderIds([]);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error("Bulk delete error:", err);
      setError("일부 주문을 삭제하는 중 오류가 발생했습니다.");
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(oid => oid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (filteredOrders: Order[]) => {
    if (selectedOrderIds.length === filteredOrders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(filteredOrders.map(o => o.id!).filter(Boolean));
    }
  };

  const updateOrderStatus = async (id: string, newStatus: Order['status']) => {
    try {
      if (isDemoMode) {
        const newOrders = orders.map(o => o.id === id ? { ...o, status: newStatus } : o);
        setOrders(newOrders);
        localStorage.setItem('demo_orders', JSON.stringify(newOrders));
      } else {
        await updateDoc(doc(db, 'orders', id), { status: newStatus });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${id}`);
    }
  };

  const handleSort = (key: keyof Order) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const exportToCSV = () => {
    if (orders.length === 0) return;
    
    const headers = ['날짜', '품목', '이름', '연락처', '주소', '금액', '상태'];
    const rows = orders.map(o => [
      o.date,
      o.item,
      o.name,
      o.phone,
      o.address,
      o.amount,
      o.status
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${v}"`).join(','))
    ].join('\n');

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `주문관리_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const generateReplyMessage = (order: Order, type: 'confirm' | 'shipping' | 'complete' | 'anniversary') => {
    const name = order.name;
    const item = order.item;
    const address = order.address;
    const greeting = storeName ? `안녕하세요 ${name}님! [${storeName}]입니다. 😊` : `안녕하세요 ${name}님!`;
    
    switch (type) {
      case 'confirm':
        return `${greeting} 당근마켓에서 문의하신 [${item}] 주문 확인되었습니다. 입금 확인되는 대로 발급 도와드리겠습니다. 감사합니다!`;
      case 'shipping':
        return `${greeting} 주문하신 [${item}] 상품 오늘 발송 예정입니다. 배송지: ${address}. 운송장은 발송 후 다시 안내해 드릴게요!`;
      case 'complete':
        return `${greeting} 주문하신 [${item}] 상품 배송이 완료되었습니다. 혹시 문제 있으시면 말씀해 주시고, 괜찮으시다면 소중한 후기 부탁드려요. 감사합니다! 좋은 하루 보내세요!`;
      case 'anniversary':
        return `${greeting} 지난번에 주문해 주신 [${item}]는 맛있게 드셨나요? 어느덧 한 달이 지났네요. 😊\n\n혹시 재구매가 필요하시거나 다른 제철 상품이 궁금하시면 언제든 말씀해 주세요! 다시 찾아주시면 더 신경 써서 챙겨드릴게요. 감사합니다!`;
      default:
        return '';
    }
  };

  const openHistory = (name: string, phone?: string) => {
    setHistoryCustomerName(name);
    setHistoryCustomerPhone(phone || null);
    setShowHistoryModal(true);
  };

  const openReply = (order: Order) => {
    setReplyOrder(order);
    setAiTips(null);
    setShowReplyModal(true);
  };

  const generateAITips = async (item: string) => {
    if (!item) return;
    setIsGeneratingTips(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: GENAI_MODEL,
        contents: [{
          parts: [{
            text: `당신은 친절한 당근마켓 판매자${storeName ? ` '${storeName}' (상점명)` : ''}입니다. 다음 식재료(또는 상품)의 '신선한 보관방법, 깨끗한 손질법, 맛있는 조리 팁'을 작성해 주세요. 
          
[중요 규칙]
1. 마크다운 기호(예: **, ###, -, * 등)를 절대 사용하지 마세요.
2. 대신 이모지와 줄바꿈을 사용하여 읽기 편하게 작성하세요.
3. 불렛 포인트 기호가 필요하다면 '•' 기호를 사용하세요.
4. 고객이 감동할 수 있도록 정중하고 다정한 말투로 작성해줘. 

상품명: ${item}`,
          }],
        }],
      });
      
      // 마크다운 흔적 제거를 위한 추가 처리
      const cleanText = response.text
        .replace(/\*\*/g, '')
        .replace(/#{1,6}\s?/g, '')
        .trim();
        
      setAiTips(cleanText);
    } catch (err) {
      console.error("AI Tips error:", err);
      setAiTips("죄송합니다. 팁을 가져오는 중 오류가 발생했습니다.");
    } finally {
      setIsGeneratingTips(false);
    }
  };

  const handleSaveStoreName = async (name: string) => {
    setIsSavingSettings(true);
    try {
      if (isDemoMode) {
        localStorage.setItem('store_name', name);
      } else if (user) {
        await setDoc(doc(db, 'users', user.uid), { storeName: name }, { merge: true });
      }
      setStoreName(name);
      setShowSettingsModal(false);
    } catch (err) {
      console.error("Save store name error:", err);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const isAnniversary = (orderDate: string): boolean => {
    if (!orderDate) return false;
    const date = new Date(orderDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    // 25~35 days range for "roughly a month"
    return diffDays >= 25 && diffDays <= 35;
  };

  const markFollowUpSent = async (id: string, type: 'tips' | 'followUp') => {
    try {
      const field = type === 'tips' ? 'tipsSent' : 'followUpSent';
      if (isDemoMode) {
        const newOrders = orders.map(o => o.id === id ? { ...o, [field]: true } : o);
        setOrders(newOrders);
        localStorage.setItem('demo_orders', JSON.stringify(newOrders));
      } else {
        await updateDoc(doc(db, 'orders', id), { [field]: true });
      }
    } catch (err) {
      console.error("Update error:", err);
    }
  };

  const filteredAndSortedOrders = orders
    .filter(order => {
      // Text Search
      const searchStr = filterText.toLowerCase();
      const matchesText = (
        order.name.toLowerCase().includes(searchStr) ||
        order.item.toLowerCase().includes(searchStr) ||
        order.phone?.toLowerCase().includes(searchStr) ||
        order.address?.toLowerCase().includes(searchStr)
      );

      if (!matchesText) return false;

      // Status Filter
      if (statusFilter !== 'all' && order.status !== statusFilter) return false;

      // Period Filter
      if (periodFilter === 'all') return true;

      const orderDate = new Date(order.date || '');
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      if (periodFilter === 'year') {
        return orderDate.getFullYear() === now.getFullYear();
      }
      
      if (periodFilter === 'month') {
        return (
          orderDate.getFullYear() === now.getFullYear() &&
          orderDate.getMonth() === now.getMonth()
        );
      }

      if (periodFilter === 'lastMonth') {
        const lastMonth = new Date();
        lastMonth.setMonth(now.getMonth() - 1);
        return (
          orderDate.getFullYear() === lastMonth.getFullYear() &&
          orderDate.getMonth() === lastMonth.getMonth()
        );
      }

      if (periodFilter === 'week') {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);
        return orderDate >= oneWeekAgo && orderDate <= now;
      }

      if (periodFilter === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        return (
          orderDate.getFullYear() === yesterday.getFullYear() &&
          orderDate.getMonth() === yesterday.getMonth() &&
          orderDate.getDate() === yesterday.getDate()
        );
      }

      return true;
    })
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      const aValue = a[key] ?? '';
      const bValue = b[key] ?? '';
      
      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });

  const totalAmount = filteredAndSortedOrders.reduce((sum, order) => sum + (order.amount || 0), 0);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-4">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200">
            <FileText className="h-8 w-8" />
          </div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">당근 주문 자동 시트</h1>
          <p className="text-slate-500">채팅 캡쳐 한 장으로 주문 관리를 스마트하게 시작하세요.</p>
        </div>
        <button
          onClick={handleLogin}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-8 py-4 font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-slate-50 hover:shadow-md active:scale-95"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="h-5 w-5" alt="Google" />
          Google로 시작하기
        </button>
        <button
          onClick={() => setIsDemoMode(true)}
          className="mt-6 text-sm font-medium text-slate-400 transition-colors hover:text-orange-500 hover:underline"
        >
          로그인 없이 데모 모드로 시작하기
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white">
                <FileText className="h-6 w-6" />
              </div>
              <h1 className="hidden text-xl font-bold text-slate-900 sm:block">당근 주문 자동 시트</h1>
            </div>
            <button 
              onClick={() => setShowTutorial(!showTutorial)}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 transition-all hover:bg-orange-100 hover:text-orange-600"
            >
              <HelpCircle className="h-3 w-3" />
              사용 가이드
              {showTutorial ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full bg-slate-100 p-1 pr-3">
              <img src={user.photoURL || ''} className="h-8 w-8 rounded-full" alt={user.displayName || ''} />
              <span className="text-sm font-medium text-slate-700">{user.displayName}</span>
            </div>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-orange-500"
              title="상점 설정"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              onClick={handleLogout}
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Tutorial Section */}
        <AnimatePresence>
          {showTutorial && (
            <motion.section
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-8 overflow-hidden"
            >
              <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900">🚀 당근 주문 자동 시트 사용법</h2>
                  <button onClick={() => setShowTutorial(false)} className="text-slate-400 hover:text-slate-600">×</button>
                </div>
                <div className="grid gap-6 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">1</div>
                    <h3 className="font-bold text-slate-800">이미지 업로드</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      주문 내역이 포함된 채팅 화면을 캡쳐하여 업로드하세요. 여러 장을 한꺼번에 올릴 수도 있습니다.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">2</div>
                    <h3 className="font-bold text-slate-800">데이터 추출 및 확인</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      AI가 자동으로 이름, 연락처, 주소, 품목을 추출합니다. 잘못된 정보가 있다면 직접 수정 후 저장하세요.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">3</div>
                    <h3 className="font-bold text-slate-800">주문 관리 및 내보내기</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      저장된 주문은 필터링, 정렬, 상태 변경이 가능합니다. 필요할 때 CSV 파일로 내보내어 엑셀에서 활용하세요.
                    </p>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {/* Upload Section */}
        <section className="mb-10">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center transition-colors hover:border-orange-300">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/*"
                  multiple
                  className="hidden"
                  id="capture-upload"
                />
                <label htmlFor="capture-upload" className="cursor-pointer">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-orange-500">
                    {isAnalyzing ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
                  </div>
                  <h3 className="mb-1 font-bold text-slate-900">채팅 캡쳐 업로드</h3>
                  <p className="text-sm text-slate-500">이미지를 선택하면 AI가 주문 정보를 추출합니다.</p>
                </label>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-bold text-slate-900">
                    <ImageIcon className="h-5 w-5 text-orange-500" />
                    추출된 정보 확인
                  </h3>
                  <button 
                    onClick={addManualOrder}
                    className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-orange-500"
                  >
                    <Plus className="h-3 w-3" />
                    수동 추가
                  </button>
                </div>
                
                {extractedOrders.length > 0 ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-500">
                        총 {extractedOrders.length}개의 주문이 추출되었습니다.
                      </p>
                      <button
                        onClick={saveAllOrders}
                        className="text-sm font-bold text-orange-500 hover:text-orange-600"
                      >
                        모두 저장하기
                      </button>
                    </div>

                    <div className="max-h-[500px] space-y-8 overflow-y-auto pr-2">
                      <AnimatePresence mode="popLayout">
                        {extractedOrders.map((order, index) => (
                          <motion.div 
                            key={order.tempId}
                            layout
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            className="relative rounded-xl border border-slate-100 bg-slate-50/50 p-4"
                          >
                            <button 
                              onClick={() => removeExtractedOrder(order.tempId)}
                              className="absolute -right-2 -top-2 rounded-full bg-white p-1 text-slate-400 shadow-sm hover:text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase">날짜</label>
                                <input 
                                  type="date" 
                                  value={order.date || ''} 
                                  onChange={e => {
                                    const newOrders = [...extractedOrders];
                                    newOrders[index].date = e.target.value;
                                    setExtractedOrders(newOrders);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-orange-500 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase">품목</label>
                                <input 
                                  type="text" 
                                  value={order.item || ''} 
                                  onChange={e => {
                                    const newOrders = [...extractedOrders];
                                    newOrders[index].item = e.target.value;
                                    setExtractedOrders(newOrders);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-orange-500 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-xs font-semibold text-slate-400 uppercase">이름</label>
                                  {getRepeatCount(order.name, order.phone) > 0 && (
                                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-600">
                                      재구매 {getRepeatCount(order.name, order.phone)}회
                                    </span>
                                  )}
                                </div>
                                <input 
                                  type="text" 
                                  value={order.name || ''} 
                                  onChange={e => {
                                    const newOrders = [...extractedOrders];
                                    newOrders[index].name = e.target.value;
                                    setExtractedOrders(newOrders);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-orange-500 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase">연락처</label>
                                <input 
                                  type="text" 
                                  value={order.phone || ''} 
                                  onChange={e => {
                                    const newOrders = [...extractedOrders];
                                    newOrders[index].phone = e.target.value;
                                    setExtractedOrders(newOrders);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-orange-500 focus:outline-none"
                                />
                              </div>
                              <div className="sm:col-span-2 space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase">주소</label>
                                <input 
                                  type="text" 
                                  value={order.address || ''} 
                                  onChange={e => {
                                    const newOrders = [...extractedOrders];
                                    newOrders[index].address = e.target.value;
                                    setExtractedOrders(newOrders);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-orange-500 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase">금액</label>
                                <input 
                                  type="number" 
                                  value={order.amount || ''} 
                                  onChange={e => {
                                    const newOrders = [...extractedOrders];
                                    newOrders[index].amount = Number(e.target.value);
                                    setExtractedOrders(newOrders);
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-orange-500 focus:outline-none"
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => saveOrder(order.tempId)}
                              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-bold text-white transition-all hover:bg-slate-800 active:scale-95"
                            >
                              <Save className="h-4 w-4" />
                              이 주문만 저장
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-40 flex-col items-center justify-center text-slate-400">
                    {isAnalyzing ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                        <p className="text-sm font-medium">이미지를 분석하고 있습니다...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-center">
                        <Search className="h-10 w-10 opacity-20" />
                        <p className="text-sm">업로드된 이미지가 없습니다.</p>
                        <button 
                          onClick={addManualOrder}
                          className="mt-2 flex items-center gap-1 text-xs font-bold text-orange-500 hover:text-orange-600 hover:underline"
                        >
                          <Plus className="h-3 w-3" />
                          직접 입력하기
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Sheet Section */}
        <section>
          <div className="mb-6 flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-slate-900">주문 관리 시트</h2>
                <div className="text-sm text-slate-500">총 {orders.length}건의 주문</div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap rounded-lg bg-slate-200 p-1">
                  {(['all', 'year', 'month', 'lastMonth', 'week', 'yesterday'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriodFilter(p)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-bold transition-all",
                        periodFilter === p 
                          ? "bg-white text-slate-900 shadow-sm" 
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      {p === 'all' && '전체'}
                      {p === 'year' && '올해'}
                      {p === 'month' && '이번달'}
                      {p === 'lastMonth' && '지난달'}
                      {p === 'week' && '최근 1주'}
                      {p === 'yesterday' && '어제'}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap rounded-lg bg-slate-200 p-1">
                  {(['all', '대기', '완료', 'A/S'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-bold transition-all",
                        statusFilter === s 
                          ? "bg-white text-slate-900 shadow-sm" 
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      {s === 'all' ? '상태 전체' : s}
                    </button>
                  ))}
                </div>

                <div className="h-6 w-px bg-slate-200 mx-2 hidden sm:block"></div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowSaveFilterModal(true)}
                    className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-orange-50 hover:text-orange-600 active:scale-95"
                    title="현재 필터 저장"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    필터 저장
                  </button>

                  {savedFilters.length > 0 && (
                    <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-[300px] no-scrollbar">
                      <AnimatePresence mode="popLayout">
                        {savedFilters.map((filter) => (
                          <motion.div
                            key={filter.id}
                            layout
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="flex shrink-0 items-center gap-1 rounded-full bg-orange-100 pl-3 pr-1 py-1 text-[10px] font-bold text-orange-700"
                          >
                            <button onClick={() => applySavedFilter(filter)} className="hover:underline">
                              {filter.name}
                            </button>
                            <button 
                              onClick={() => filter.id && deleteSavedFilter(filter.id)}
                              className="rounded-full p-0.5 hover:bg-orange-200"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all hover:bg-slate-50 active:scale-95"
                >
                  <Download className="h-4 w-4" />
                  내보내기
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {selectedOrderIds.length > 0 && (
                  <div className="flex items-center gap-2">
                    {!showDeleteConfirm ? (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm font-bold text-red-600 transition-all hover:bg-red-100 active:scale-95"
                      >
                        <Trash2 className="h-4 w-4" />
                        {selectedOrderIds.length}개 삭제
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-red-600 p-1">
                        <span className="px-2 text-xs font-bold text-white">정말 삭제할까요?</span>
                        <button
                          onClick={deleteSelectedOrders}
                          disabled={isDeleting}
                          className="rounded-md bg-white px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {isDeleting ? '삭제 중...' : '확인'}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={isDeleting}
                          className="rounded-md px-3 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          취소
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="relative flex-1 sm:w-80">
                <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="이름, 품목, 연락처 검색..."
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-500/10"
                />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input 
                        type="checkbox" 
                        checked={filteredAndSortedOrders.length > 0 && selectedOrderIds.length === filteredAndSortedOrders.length}
                        onChange={() => toggleSelectAll(filteredAndSortedOrders)}
                        className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                      />
                    </th>
                    <th onClick={() => handleSort('status')} className="cursor-pointer hover:bg-slate-50 w-24">
                      <div className="flex items-center gap-1">상태 <ArrowUpDown className="h-3 w-3" /></div>
                    </th>
                    <th onClick={() => handleSort('date')} className="cursor-pointer hover:bg-slate-50">
                      <div className="flex items-center gap-1">날짜 <ArrowUpDown className="h-3 w-3" /></div>
                    </th>
                    <th onClick={() => handleSort('item')} className="cursor-pointer hover:bg-slate-50">
                      <div className="flex items-center gap-1">품목 <ArrowUpDown className="h-3 w-3" /></div>
                    </th>
                    <th onClick={() => handleSort('name')} className="cursor-pointer hover:bg-slate-50">
                      <div className="flex items-center gap-1">이름 <ArrowUpDown className="h-3 w-3" /></div>
                    </th>
                    <th>연락처</th>
                    <th>주소</th>
                    <th onClick={() => handleSort('amount')} className="cursor-pointer hover:bg-slate-50">
                      <div className="flex items-center gap-1">금액 <ArrowUpDown className="h-3 w-3" /></div>
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {filteredAndSortedOrders.length > 0 ? (
                      filteredAndSortedOrders.map((order) => (
                        <motion.tr 
                          key={order.id} 
                          layout
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className={cn(selectedOrderIds.includes(order.id!) && "bg-orange-50/30")}
                        >
                          <td>
                            <input 
                              type="checkbox" 
                              checked={selectedOrderIds.includes(order.id!)}
                              onChange={() => toggleSelectOrder(order.id!)}
                              className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                            />
                          </td>
                          <td>
                            <select
                              value={order.status}
                              onChange={(e) => order.id && updateOrderStatus(order.id, e.target.value as Order['status'])}
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-bold border-none focus:ring-2 focus:ring-offset-1 transition-colors duration-300",
                                order.status === '완료' ? "bg-green-100 text-green-700 focus:ring-green-500" :
                                order.status === 'A/S' ? "bg-red-100 text-red-700 focus:ring-red-500" :
                                "bg-amber-100 text-amber-700 focus:ring-amber-500"
                              )}
                            >
                              <option value="대기">대기</option>
                              <option value="완료">완료</option>
                              <option value="A/S">A/S</option>
                            </select>
                          </td>
                          <td className="whitespace-nowrap font-medium">
                            <div className="flex items-center gap-2">
                              {order.date}
                              {isAnniversary(order.date || '') && !order.followUpSent && (
                                <motion.div
                                  initial={{ scale: 0.5, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                                  title="1달 안부 알림"
                                />
                              )}
                            </div>
                          </td>
                          <td className="font-semibold text-slate-700">{order.item}</td>
                          <td>
                            <button 
                              onClick={() => openHistory(order.name, order.phone)}
                              className="flex flex-col text-left transition-colors hover:text-orange-600"
                            >
                              <span className="font-medium underline decoration-slate-200 underline-offset-4">{order.name}</span>
                              {getRepeatCount(order.name, order.phone) > 1 && (
                                <span className="mt-0.5 w-fit rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
                                  재구매 {getRepeatCount(order.name, order.phone)}회
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="whitespace-nowrap">{order.phone}</td>
                          <td className="max-w-xs truncate">{order.address}</td>
                          <td className="font-bold text-orange-600">
                            {order.amount?.toLocaleString()}원
                          </td>
                          <td className="w-20">
                            <div className="flex items-center gap-1">
                              {!showSingleDeleteConfirm || orderToDelete !== order.id ? (
                                <>
                                  <button
                                    onClick={() => openReply(order)}
                                    className="rounded p-1 text-slate-300 hover:bg-blue-50 hover:text-blue-500"
                                    title="간편 답장"
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => order.id && deleteOrder(order.id)}
                                    className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"
                                    title="삭제"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={confirmDeleteOrder}
                                    className="text-[10px] font-bold text-red-600 hover:underline"
                                  >
                                    확인
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowSingleDeleteConfirm(false);
                                      setOrderToDelete(null);
                                    }}
                                    className="text-[10px] font-bold text-slate-400 hover:underline"
                                  >
                                    취소
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      ))
                    ) : (
                      <motion.tr
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <td colSpan={9} className="py-20 text-center text-slate-400">
                          {filterText || periodFilter !== 'all' ? '검색 결과가 없습니다.' : '저장된 주문이 없습니다.'}
                        </td>
                      </motion.tr>
                    )}
                    {filteredAndSortedOrders.length > 0 && (
                      <motion.tr 
                        key="total"
                        layout
                        className="bg-slate-50 font-bold border-t-2 border-slate-200"
                      >
                        <td colSpan={7} className="px-4 py-4 text-right text-slate-600">
                          검색 결과 합계:
                        </td>
                        <td className="px-4 py-4 text-orange-600">
                          {totalAmount.toLocaleString()}원
                        </td>
                        <td colSpan={1}></td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* Floating Action Button for Mobile */}
      <div className="fixed bottom-6 right-6 sm:hidden">
        <label htmlFor="capture-upload" className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-300 active:scale-95">
          <Plus className="h-8 w-8" />
        </label>
      </div>

      {/* Save Filter Modal */}
      <AnimatePresence>
        {showSaveFilterModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSaveFilterModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            >
              <h3 className="mb-4 text-lg font-bold text-slate-900">현재 필터 조합 저장</h3>
              <p className="mb-4 text-sm text-slate-500">
                현재 설정된 기간, 상태, 검색어 필터를 나중에 다시 사용할 수 있도록 이름을 지정하여 저장합니다.
              </p>
              
              <div className="mb-6 space-y-4">
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex justify-between mb-1">
                    <span>기간:</span>
                    <span className="font-bold">{periodFilter === 'all' ? '전체' : periodFilter}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span>상태:</span>
                    <span className="font-bold">{statusFilter === 'all' ? '전체' : statusFilter}</span>
                  </div>
                  {filterText && (
                    <div className="flex justify-between">
                      <span>검색어:</span>
                      <span className="font-bold">"{filterText}"</span>
                    </div>
                  )}
                </div>
                
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">필터 이름</label>
                  <input
                    type="text"
                    value={newFilterName}
                    onChange={(e) => setNewFilterName(e.target.value)}
                    placeholder="예: 지난달 완료 주문"
                    className="w-full rounded-lg border border-slate-200 p-3 text-sm focus:border-orange-500 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSaveFilterModal(false)}
                  className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200"
                >
                  취소
                </button>
                <button
                  onClick={saveCurrentFilter}
                  disabled={!newFilterName.trim() || isSavingFilter}
                  className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white shadow-lg shadow-orange-200 transition-all hover:bg-orange-600 disabled:opacity-50"
                >
                  {isSavingFilter ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : '저장하기'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && historyCustomerName && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistoryModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                    <UserIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{historyCustomerName} 님의 주문 내역</h3>
                    <p className="text-sm text-slate-500">{historyCustomerPhone || '연락처 정보 없음'}</p>
                  </div>
                </div>
                <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="max-h-[400px] overflow-y-auto pr-2">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase">
                      <th className="pb-3">날짜</th>
                      <th className="pb-3">품목</th>
                      <th className="pb-3">금액</th>
                      <th className="pb-3">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {orders
                      .filter(o => 
                        o.name === historyCustomerName || 
                        (o.phone && historyCustomerPhone && o.phone.replace(/\D/g, '') === historyCustomerPhone.replace(/\D/g, ''))
                      )
                      .map(o => (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="py-3 text-slate-500">{o.date}</td>
                          <td className="py-3 font-semibold text-slate-700">{o.item}</td>
                          <td className="py-3 font-bold text-orange-600">{o.amount?.toLocaleString()}원</td>
                          <td className="py-3">
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold",
                              o.status === '완료' ? "bg-green-100 text-green-700" :
                              o.status === 'A/S' ? "bg-red-100 text-red-700" :
                              "bg-amber-100 text-amber-700"
                            )}>
                              {o.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reply Modal */}
      <AnimatePresence>
        {showReplyModal && replyOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReplyModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">간편 답장 생성</h3>
                </div>
                <button onClick={() => setShowReplyModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-2">
                {/* Regular Templates */}
                {(['confirm', 'shipping', 'complete'] as const).map(type => (
                  <div key={type} className="group relative rounded-xl border border-slate-100 bg-slate-50 p-4 transition-all hover:border-blue-200 hover:bg-white hover:shadow-md">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600 uppercase">
                        {type === 'confirm' && '입금 확인/예약'}
                        {type === 'shipping' && '발급/배송 안내'}
                        {type === 'complete' && '판매 완료/후기 요청'}
                      </span>
                      <button 
                        onClick={() => copyToClipboard(generateReplyMessage(replyOrder, type))}
                        className="flex items-center gap-1 rounded-lg bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-blue-50 hover:text-blue-600 active:scale-95"
                      >
                        <Copy className="h-3 w-3" />
                        복사
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {generateReplyMessage(replyOrder, type)}
                    </p>
                  </div>
                ))}

                {/* Anniversary Template */}
                {isAnniversary(replyOrder.date || '') && (
                  <div className="group relative rounded-xl border border-red-100 bg-red-50 p-4 transition-all hover:border-red-200 hover:bg-white hover:shadow-md">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-red-500" />
                        <span className="text-xs font-bold text-red-600 uppercase">1달 기념 안부 & 재구매 유도</span>
                        {replyOrder.followUpSent && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                      </div>
                      <button 
                        onClick={() => {
                          copyToClipboard(generateReplyMessage(replyOrder, 'anniversary'));
                          if (replyOrder.id) markFollowUpSent(replyOrder.id, 'followUp');
                        }}
                        className="flex items-center gap-1 rounded-lg bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-600 active:scale-95"
                      >
                        <Copy className="h-3 w-3" />
                        복사
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                      {generateReplyMessage(replyOrder, 'anniversary')}
                    </p>
                  </div>
                )}

                {/* AI Product Tips Section */}
                <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-orange-500" />
                      <h4 className="text-sm font-bold text-slate-900">AI 상품 관리 꿀팁 (보관/손질/조리)</h4>
                    </div>
                    {aiTips && (
                      <button 
                        onClick={() => generateAITips(replyOrder.item)}
                        disabled={isGeneratingTips}
                        className="text-slate-400 hover:text-orange-500 disabled:opacity-50"
                        title="새로고침"
                      >
                        <RefreshCw className={cn("h-4 w-4", isGeneratingTips && "animate-spin")} />
                      </button>
                    )}
                  </div>

                  {aiTips ? (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-white p-3 text-sm text-slate-600 leading-relaxed shadow-sm border border-orange-100 whitespace-pre-wrap">
                        {aiTips}
                      </div>
                      <button 
                        onClick={() => {
                          const tipMessage = `안녕하세요 ${replyOrder.name}님! ${storeName ? `[${storeName}]입니다. ` : ''}주문하신 [${replyOrder.item}] 더 맛있고 신선하게 즐기실 수 있는 꿀팁 전해드려요. 🥕\n\n${aiTips}\n\n도움이 되셨으면 좋겠습니다. 감사합니다!`;
                          copyToClipboard(tipMessage);
                          if (replyOrder.id) markFollowUpSent(replyOrder.id, 'tips');
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white shadow-md shadow-orange-100 hover:bg-orange-600 active:scale-95"
                      >
                        <Copy className="h-4 w-4" />
                        전문가 꿀팁 메시지 복사
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => generateAITips(replyOrder.item)}
                      disabled={isGeneratingTips}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-orange-200 py-6 text-sm font-bold text-orange-600 transition-colors hover:bg-orange-100/50 disabled:opacity-50"
                    >
                      {isGeneratingTips ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          AI가 꿀팁을 작성하고 있습니다...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-5 w-5" />
                          상품 맞춤 꿀팁 생성하기
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {copySuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-green-600"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    클립보드에 복사되었습니다!
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettingsModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                    <Settings className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">상점 설정</h3>
                </div>
                <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">상점 이름</label>
                  <p className="text-xs text-slate-500">입력하신 상점 이름은 자동 답장 메시지의 인사말에 사용됩니다.</p>
                  <input
                    type="text"
                    placeholder="예: 민수네 과일가게"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm focus:border-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-500/10"
                  />
                  {storeName && (
                    <button 
                      onClick={() => setStoreName('')}
                      className="text-xs font-bold text-red-500 hover:underline"
                    >
                      상점 이름 삭제
                    </button>
                  )}
                </div>

                <div className="rounded-xl bg-orange-50 p-4">
                  <h4 className="mb-2 text-xs font-bold text-orange-700 uppercase">미리보기</h4>
                  <p className="text-sm text-slate-600 italic">
                    {storeName ? `안녕하세요 고객님! [${storeName}]입니다. 😊` : "안녕하세요 고객님!"}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleSaveStoreName(storeName)}
                    disabled={isSavingSettings}
                    className="flex-[2] rounded-xl bg-orange-500 py-3 text-sm font-bold text-white shadow-lg shadow-orange-100 transition-all hover:bg-orange-600 active:scale-95 disabled:opacity-50"
                  >
                    {isSavingSettings ? '저장 중...' : '설정 저장하기'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
