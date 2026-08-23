import React, { useState, useEffect } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Key,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import {
  TEMP_ASSET_SCHEMA_DEF,
  DEFAULT_SCHEMA_DEF,
  fetchTableSchema,
  saveTableSchema,
  applySchemaPatch,
  getMainFieldName
} from '../utils/dynamicSchema';

export default function SchemaBuilderTab({ onError, onSchemaUpdated }) {
  const [schemaDef, setSchemaDef] = useState(TEMP_ASSET_SCHEMA_DEF);
  const [resetData, setResetData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    fetchTableSchema('temp_asset').then(def => {
      if (def) setSchemaDef(def);
    });
  }, []);

  // 필드 속성 변경
  const handleFieldChange = (idx, field, value) => {
    setSchemaDef(prev => {
      const updatedFields = [...prev.fields];
      updatedFields[idx] = {
        ...updatedFields[idx],
        [field]: value
      };
      return { ...prev, fields: updatedFields };
    });
  };

  // 키 인덱스 지정 (라디오)
  const handleSelectKeyField = (fieldId, fieldName) => {
    setSchemaDef(prev => ({
      ...prev,
      key_field: fieldId,
      key_field_name: fieldName,
      fields: prev.fields.map(f => ({
        ...f,
        isKey: f.id === fieldId,
        isRequired: f.id === fieldId ? true : f.isRequired
      }))
    }));
  };

  // 신규 헤더 행 추가
  const handleAddField = () => {
    const newId = `field_${Date.now().toString().slice(-4)}`;
    const newField = {
      id: newId,
      name: `항목_${schemaDef.fields.length + 1}`,
      type: 'VARCHAR',
      length: 50,
      isKey: false,
      isRequired: false,
      isBarcodeTarget: true,
      order: schemaDef.fields.length + 1
    };
    setSchemaDef(prev => ({
      ...prev,
      fields: [...prev.fields, newField]
    }));
  };

  // 헤더 행 삭제
  const handleRemoveField = (idx) => {
    const target = schemaDef.fields[idx];
    if (target.isKey || target.id === schemaDef.key_field) {
      alert('키 인덱스로 지정된 헤더는 삭제할 수 없습니다. 다른 키를 먼저 지정하세요.');
      return;
    }
    if (schemaDef.fields.length <= 1) {
      alert('최소 1개 이상의 헤더가 필요합니다.');
      return;
    }
    setSchemaDef(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== idx)
    }));
  };

  // 기본 스키마로 초기화
  const handleReset = () => {
    if (window.confirm('스키마 정의를 초기 기본값으로 되돌리시겠습니까?')) {
      setSchemaDef(TEMP_ASSET_SCHEMA_DEF);
    }
  };

  // ⭐️ 스키마 저장 및 동기화
  const handleApplyPatch = async () => {
    if (!schemaDef.key_field) {
      alert('반드시 1개의 헤더를 키 인덱스(PK)로 지정해야 합니다.');
      return;
    }
    setIsSaving(true);
    setStatusMessage(null);

    try {
      const res = await saveTableSchema('temp_asset', schemaDef);
      setStatusMessage({
        type: 'success',
        text: '임시 자산(temp_asset) 스키마 정의가 성공적으로 저장되었습니다.'
      });
      if (onSchemaUpdated) onSchemaUpdated(schemaDef);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message });
      if (onError) onError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyDdl = () => {
    const ddlSql = `-- 1. 스키마 정의 테이블
CREATE TABLE IF NOT EXISTS public.schema_definitions (
    id VARCHAR(64) PRIMARY KEY,
    schema_name VARCHAR(100) NOT NULL,
    key_field VARCHAR(64) NOT NULL,
    key_field_name VARCHAR(100) NOT NULL,
    fields JSONB NOT NULL,
    table_version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 동적 스캔 큐 & 데이터 레코드 테이블
CREATE TABLE IF NOT EXISTS public.scan_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_value VARCHAR(100) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    scan_status VARCHAR(20) DEFAULT 'SCANNED',
    scanned_by VARCHAR(50) DEFAULT 'MOBILE_APP',
    scanned_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_records_key ON public.scan_records (key_value);
CREATE INDEX IF NOT EXISTS idx_scan_records_data ON public.scan_records USING GIN (data);

-- 3. 백엔드 라벨 서식 템플릿 테이블
CREATE TABLE IF NOT EXISTS public.label_templates (
    id VARCHAR(64) PRIMARY KEY,
    schema_id VARCHAR(64) REFERENCES public.schema_definitions(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    paper JSONB NOT NULL,
    elements JSONB NOT NULL,
    is_default BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 범용 프린트 큐 테이블
CREATE TABLE IF NOT EXISTS public.print_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_record_id UUID REFERENCES public.scan_records(id) ON DELETE SET NULL,
    template_id VARCHAR(64) REFERENCES public.label_templates(id),
    key_value VARCHAR(100) NOT NULL,
    record_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    zpl_payload TEXT NOT NULL,
    print_status VARCHAR(20) DEFAULT 'PENDING',
    print_error TEXT DEFAULT NULL,
    agent_id VARCHAR(100) DEFAULT NULL,
    requested_by VARCHAR(50) DEFAULT 'SYSTEM',
    printed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RLS 정책 일괄 허용
ALTER TABLE public.schema_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all schema_definitions" ON public.schema_definitions;
CREATE POLICY "Allow all schema_definitions" ON public.schema_definitions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all scan_records" ON public.scan_records;
CREATE POLICY "Allow all scan_records" ON public.scan_records FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all label_templates" ON public.label_templates;
CREATE POLICY "Allow all label_templates" ON public.label_templates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all print_queue" ON public.print_queue;
CREATE POLICY "Allow all print_queue" ON public.print_queue FOR ALL USING (true) WITH CHECK (true);`;

    navigator.clipboard.writeText(ddlSql).then(() => {
      alert('전체 DDL SQL이 클립보드에 복사되었습니다!\nNeon 콘솔 > SQL Editor에 붙여넣고 Run을 실행하세요.');
    }).catch(() => {
      alert('클립보드 복사 실패. schema.sql 파일을 확인해 주세요.');
    });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      color: '#f8fafc',
      width: '100%'
    }}>
      {/* Top Action Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '6px 12px',
        flexWrap: 'wrap',
        gap: '6px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Database size={16} style={{ color: '#38bdf8' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>스키마 빌더</span>
          <span style={{
            fontSize: '0.72rem',
            backgroundColor: '#0f172a',
            color: '#38bdf8',
            padding: '2px 6px',
            borderRadius: '4px',
            border: '1px solid #334155'
          }}>
            키: {getMainFieldName(schemaDef.key_field_name)} ({schemaDef.key_field})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.72rem', color: '#f87171' }}>
            <input
              type="checkbox"
              checked={resetData}
              onChange={e => setResetData(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            데이터 초기화
          </label>
          <button
            onClick={handleCopyDdl}
            className="btn btn-outline"
            style={{ fontSize: '0.72rem', padding: '4px 10px', borderColor: '#38bdf8', color: '#38bdf8' }}
            title="PostgreSQL DDL 복사"
          >
            DDL 복사
          </button>
          <button
            onClick={handleAddField}
            className="btn btn-outline"
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
          >
            <Plus size={12} /> 행 추가
          </button>
          <button
            onClick={handleReset}
            className="btn btn-outline"
            style={{ fontSize: '0.72rem', padding: '4px 10px' }}
          >
            <RotateCcw size={12} /> 초기화
          </button>
          <button
            onClick={handleApplyPatch}
            disabled={isSaving}
            className="btn btn-primary"
            style={{ fontSize: '0.72rem', padding: '4px 14px' }}
          >
            <Save size={12} /> {isSaving ? '패치중' : '적용 & DDL 패치'}
          </button>
        </div>
      </div>

      {/* Status Feedback */}
      {statusMessage && (
        <div style={{
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '0.75rem',
          backgroundColor: statusMessage.type === 'success' ? '#052e16' : '#450a0a',
          color: statusMessage.type === 'success' ? '#4ade80' : '#f87171',
          border: `1px solid ${statusMessage.type === 'success' ? '#10b981' : '#ef4444'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          {statusMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          {statusMessage.text}
        </div>
      )}

      {/* Schema Editor Grid Table */}
      <div style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: '60px', whiteSpace: 'nowrap' }}>키 인덱스</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', width: '140px', whiteSpace: 'nowrap' }}>헤더 ID (영문)</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', width: '220px', whiteSpace: 'nowrap' }}>표시명 (라벨)</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', width: '110px', whiteSpace: 'nowrap' }}>데이터타입</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: '80px', whiteSpace: 'nowrap' }}>바코드 대상</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: '70px', whiteSpace: 'nowrap' }}>필수 여부</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', width: '50px', whiteSpace: 'nowrap' }}>삭제</th>
            </tr>
          </thead>
          <tbody>
            {schemaDef.fields.map((field, idx) => {
              const isKey = field.id === schemaDef.key_field;
              return (
                <tr key={field.id || idx} style={{ borderBottom: '1px solid #334155' }}>
                  {/* 키 인덱스 지정 (라디오) */}
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <input
                      type="radio"
                      name="schema_key_selector"
                      checked={isKey}
                      onChange={() => handleSelectKeyField(field.id, field.name)}
                      style={{ cursor: 'pointer' }}
                      title="고유 키 인덱스로 지정"
                    />
                  </td>

                  {/* 헤더 ID */}
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="text"
                      value={field.id}
                      disabled={isKey && (field.id === 'asset_no' || field.id === 'imei')}
                      onChange={e => handleFieldChange(idx, 'id', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      style={{
                        width: '100%',
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        color: '#38bdf8',
                        fontFamily: 'monospace',
                        fontSize: '0.72rem'
                      }}
                    />
                  </td>

                  {/* 표시명 */}
                  <td style={{ padding: '4px 8px' }}>
                    <input
                      type="text"
                      value={field.name}
                      placeholder="주된명칭, 별칭1, 별칭2..."
                      onChange={e => {
                        handleFieldChange(idx, 'name', e.target.value);
                        if (isKey) {
                          setSchemaDef(prev => ({ ...prev, key_field_name: e.target.value }));
                        }
                      }}
                      style={{
                        width: '100%',
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    />
                  </td>

                  {/* 데이터타입 */}
                  <td style={{ padding: '4px 8px' }}>
                    <select
                      value={field.type || 'VARCHAR'}
                      onChange={e => handleFieldChange(idx, 'type', e.target.value)}
                      style={{
                        width: '100%',
                        backgroundColor: '#0f172a',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        color: '#f8fafc',
                        fontSize: '0.72rem'
                      }}
                    >
                      <option value="VARCHAR">VARCHAR (문자열)</option>
                      <option value="INTEGER">INTEGER (정수)</option>
                      <option value="TIMESTAMPTZ">TIMESTAMPTZ (일시)</option>
                      <option value="BOOLEAN">BOOLEAN (참/거짓)</option>
                    </select>
                  </td>

                  {/* 바코드 대상 여부 */}
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(field.isBarcodeTarget)}
                      onChange={e => handleFieldChange(idx, 'isBarcodeTarget', e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>

                  {/* 필수 여부 */}
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(field.isRequired || isKey)}
                      disabled={isKey}
                      onChange={e => handleFieldChange(idx, 'isRequired', e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>

                  {/* 삭제 버튼 */}
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <button
                      onClick={() => handleRemoveField(idx)}
                      disabled={isKey}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: isKey ? '#475569' : '#f87171',
                        cursor: isKey ? 'not-allowed' : 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto'
                      }}
                      title={isKey ? '키 인덱스는 삭제 불가' : '헤더 삭제'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
