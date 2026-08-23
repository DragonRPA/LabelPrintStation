import React, { useState } from 'react';
import { Database, CheckCircle, AlertCircle, X, Info } from 'lucide-react';
import { getStoredNeonConnectionString, saveStoredNeonConnectionString, testNeonConnection } from '../utils/neonClient';

export default function NeonConfigModal({ isOpen, onClose, onSaveSuccess }) {
  const [connStr, setConnStr] = useState(getStoredNeonConnectionString());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  if (!isOpen) return null;

  const handleTest = async () => {
    if (!connStr || connStr.trim().length < 15) {
      setTestResult({ success: false, message: '올바른 Neon Connection String을 입력해주세요.' });
      return;
    }
    setTesting(true);
    setTestResult(null);

    const result = await testNeonConnection(connStr.trim());
    setTesting(false);
    setTestResult(result);
  };

  const handleSave = () => {
    if (!connStr || connStr.trim().length < 15) {
      setTestResult({ success: false, message: '올바른 Connection String을 입력해주세요.' });
      return;
    }
    saveStoredNeonConnectionString(connStr.trim());
    if (onSaveSuccess) onSaveSuccess();
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '580px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00e699' }}>
            <Database size={22} />
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>Neon PostgreSQL DB 설정</h3>
          </div>
          <button className="btn btn-outline" style={{ padding: '4px 8px' }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Vertical Stack Form Layout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label className="form-label">Neon Connection String (PostgreSQL)</label>
            <input
              type="text"
              className="form-input"
              placeholder="postgresql://neondb_owner:password@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
              value={connStr}
              onChange={(e) => setConnStr(e.target.value)}
              style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}
            />
            <div style={{
              fontSize: '0.75rem',
              color: '#38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              padding: '6px 10px',
              borderRadius: '4px',
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Info size={14} />
              <span>Neon 콘솔 ➔ Connection details ➔ <strong>Connection string</strong> 복사값</span>
            </div>
          </div>

          {testResult && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: testResult.success ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)',
              color: testResult.success ? '#4ade80' : '#f87171',
              border: `1px solid ${testResult.success ? '#22c55e' : '#ef4444'}`
            }}>
              {testResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? '연결 확인중...' : '연결 테스트'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ backgroundColor: '#00e699', color: '#0f172a', fontWeight: 700 }}
            onClick={handleSave}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
