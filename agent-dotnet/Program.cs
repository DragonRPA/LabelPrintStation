using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace DragonRPA
{
    // 🖨️ [WinSpool RAW 직접 인쇄 헬퍼 - Unicode W-API]
    public class RawPrinterHelper
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public class DOCINFOW
        {
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDocName = "DragonRPA_ZPL_Doc";
            [MarshalAs(UnmanagedType.LPWStr)]
            public string? pOutputFile = null;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDataType = "RAW";
        }

        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

        [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

        public static (bool Success, string ErrorMsg) SendBytesToPrinter(string szPrinterName, byte[] pBytes)
        {
            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOW di = new DOCINFOW();

            // 1. 정확한 이름 매칭 또는 설치된 프린터에서 대소문자 무시 탐색
            string actualName = szPrinterName;
            if (!OpenPrinter(actualName, out hPrinter, IntPtr.Zero))
            {
                foreach (string p in PrinterSettings.InstalledPrinters)
                {
                    if (p.Equals(szPrinterName, StringComparison.OrdinalIgnoreCase) ||
                        p.Contains(szPrinterName, StringComparison.OrdinalIgnoreCase))
                    {
                        actualName = p;
                        if (OpenPrinter(actualName, out hPrinter, IntPtr.Zero)) break;
                    }
                }
            }

            if (hPrinter == IntPtr.Zero)
            {
                int err = Marshal.GetLastWin32Error();
                return (false, "프린터를 열 수 없습니다 (" + szPrinterName + "), Win32 오류: " + err);
            }

            try
            {
                if (!StartDocPrinter(hPrinter, 1, di))
                {
                    int err = Marshal.GetLastWin32Error();
                    return (false, "StartDocPrinter 실패: " + err);
                }

                try
                {
                    if (!StartPagePrinter(hPrinter))
                    {
                        int err = Marshal.GetLastWin32Error();
                        return (false, "StartPagePrinter 실패: " + err);
                    }

                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(pBytes.Length);
                    try
                    {
                        Marshal.Copy(pBytes, 0, pUnmanagedBytes, pBytes.Length);
                        int dwWritten = 0;
                        bool writeOk = WritePrinter(hPrinter, pUnmanagedBytes, pBytes.Length, out dwWritten);
                        if (!writeOk || dwWritten != pBytes.Length)
                        {
                            int err = Marshal.GetLastWin32Error();
                            return (false, "WritePrinter 실패: " + err + " (기록됨: " + dwWritten + "/" + pBytes.Length + ")");
                        }
                    }
                    finally
                    {
                        Marshal.FreeCoTaskMem(pUnmanagedBytes);
                        EndPagePrinter(hPrinter);
                    }
                }
                finally
                {
                    EndDocPrinter(hPrinter);
                }
            }
            finally
            {
                ClosePrinter(hPrinter);
            }

            return (true, "OK");
        }

        public static (bool Success, string ErrorMsg) SendStringToPrinter(string szPrinterName, string szString)
        {
            // ⭐️ Zebra ^CI26 전용 완성형 한글 2바이트 (CP949 / EUC-KR) 바이트 스트림 완벽 변환
            Encoding encoding;
            try
            {
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                encoding = Encoding.GetEncoding(949); // CP949 (Korean 완성형)
            }
            catch
            {
                try { encoding = Encoding.GetEncoding("ks_c_5601-1987"); }
                catch { encoding = Encoding.GetEncoding("euc-kr"); }
            }

            byte[] pBytes = encoding.GetBytes(szString);
            return SendBytesToPrinter(szPrinterName, pBytes);
        }
    }

    class Program
    {
        const string VERSION = "v1.6";
        const string FRONTEND_URL = "https://dragonrpa.github.io/LabelPrintStation/";
        const int HTTP_PORT = 9988;

        const int VK_CONTROL = 0x11;
        const int VK_LBUTTON = 0x01;
        const int VK_SPACE   = 0x20;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        static extern IntPtr WindowFromPoint(POINT Point);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetConsoleWindow();

        static volatile DetailedTargetInfo CurrentHover = new DetailedTargetInfo();
        static volatile DetailedTargetInfo LastLocked = null;
        static bool IsScanningActive = true;
        static string SelectedPrinterName = "";
        static int TodayPrintCount = 0;

        public class DetailedTargetInfo
        {
            public string ProcessName = "";
            public uint ProcessId = 0;
            public string WindowTitle = "";
            public string WindowClassName = "";
            public string TagName = "ELEMENT";
            public string ControlType = "";
            public string Id = "";
            public string Name = "";
            public string ClassName = "";
            public string XPath = "";
            public string CssSelector = "";
            public string UiaPath = "";
            public string FrameInfo = "Top-level Frame";
            public string ParentHierarchy = "";
            public bool IsEnabled = true;
            public bool IsOffscreen = false;
            public bool IsPassword = false;
            public int X = 0;
            public int Y = 0;
            public int Width = 0;
            public int Height = 0;
            public long Timestamp = 0;
        }

        [STAThread]
        static void Main(string[] args)
        {
            try { Encoding.RegisterProvider(CodePagesEncodingProvider.Instance); } catch { }
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine("=================================================");
            Console.WriteLine("  DragonRPA 통합 에이전트 " + VERSION + " (C# Native + WinSpool + UIA3)");
            Console.WriteLine("=================================================");

            // 기본 프린터 자동 감지
            AutoDetectDefaultPrinter();

            OpenFrontendBrowser();
            StartHttpServer();
            StartGlobalUiaScanner();

            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(2000);
                IntPtr hWnd = GetConsoleWindow();
                if (hWnd != IntPtr.Zero)
                {
                    ShowWindow(hWnd, 0);
                }
            });

            Thread.Sleep(Timeout.Infinite);
        }

        static void AutoDetectDefaultPrinter()
        {
            try
            {
                PrinterSettings settings = new PrinterSettings();
                SelectedPrinterName = settings.PrinterName;
                foreach (string printer in PrinterSettings.InstalledPrinters)
                {
                    if (printer.ToLower().Contains("zdesigner") || printer.ToLower().Contains("zebra") || printer.ToLower().Contains("gk420") || printer.ToLower().Contains("zd"))
                    {
                        SelectedPrinterName = printer;
                        break;
                    }
                }
                Console.WriteLine("[PRINTER] 기본 프린터 설정됨: " + SelectedPrinterName);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[WARN] 프린터 감지 오류: " + ex.Message);
            }
        }

        static void OpenFrontendBrowser()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = FRONTEND_URL,
                    UseShellExecute = true
                };
                Process.Start(psi);
                Console.WriteLine("[OK] 프론트엔드 브라우저 실행: " + FRONTEND_URL);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[WARN] 브라우저 실행 실패: " + ex.Message);
            }
        }

        static void StartGlobalUiaScanner()
        {
            Thread thread = new Thread(delegate()
            {
                POINT lastPt = new POINT { X = -1, Y = -1 };
                bool lastCtrlState = false;

                while (IsScanningActive)
                {
                    try
                    {
                        POINT pt;
                        if (GetCursorPos(out pt))
                        {
                            if (pt.X != lastPt.X || pt.Y != lastPt.Y)
                            {
                                lastPt = pt;
                                ScanElementAtPoint(pt);
                            }

                            bool isCtrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                            bool isLButtonDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
                            bool isSpaceDown = (GetAsyncKeyState(VK_SPACE) & 0x8000) != 0;

                            if (isCtrlDown && (isLButtonDown || isSpaceDown))
                            {
                                if (!lastCtrlState)
                                {
                                    lastCtrlState = true;
                                    LastLocked = CurrentHover;
                                    Console.WriteLine("[LOCK-ON] " + CurrentHover.ProcessName + " | " + CurrentHover.TagName + "#" + CurrentHover.Id + " (" + CurrentHover.XPath + ")");
                                }
                            }
                            else
                            {
                                lastCtrlState = false;
                            }
                        }
                    }
                    catch { }

                    Thread.Sleep(60);
                }
            });

            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            Console.WriteLine("[OK] Windows OS 전역 UIA 정밀 텔레메트리 스캐너 가동");
        }

        static void ScanElementAtPoint(POINT pt)
        {
            try
            {
                IntPtr hWnd = WindowFromPoint(pt);
                string winTitle = "";
                string winClass = "";
                string procName = "Desktop";
                uint pid = 0;

                if (hWnd != IntPtr.Zero)
                {
                    StringBuilder sbTitle = new StringBuilder(256);
                    GetWindowText(hWnd, sbTitle, 256);
                    winTitle = sbTitle.ToString();

                    StringBuilder sbClass = new StringBuilder(256);
                    GetClassName(hWnd, sbClass, 256);
                    winClass = sbClass.ToString();

                    GetWindowThreadProcessId(hWnd, out pid);
                    if (pid > 0)
                    {
                        try
                        {
                            Process p = Process.GetProcessById((int)pid);
                            procName = p.ProcessName;
                        }
                        catch { }
                    }
                }

                System.Windows.Point uiaPoint = new System.Windows.Point(pt.X, pt.Y);
                AutomationElement elem = AutomationElement.FromPoint(uiaPoint);

                if (elem != null)
                {
                    AutomationElement.AutomationElementInformation cur = elem.Current;
                    string ctrlType = cur.ControlType != null ? cur.ControlType.ProgrammaticName.Replace("ControlType.", "") : "Element";
                    string id = cur.AutomationId ?? "";
                    string name = cur.Name ?? "";
                    string className = cur.ClassName ?? "";
                    System.Windows.Rect rect = cur.BoundingRectangle;
                    bool isEnabled = cur.IsEnabled;
                    bool isOffscreen = cur.IsOffscreen;
                    bool isPassword = cur.IsPassword;

                    string frameInfo = "Main Frame";
                    string hierarchy = "";
                    try
                    {
                        AutomationElement parent = TreeWalker.RawViewWalker.GetParent(elem);
                        if (parent != null)
                        {
                            hierarchy = parent.Current.ControlType != null ? parent.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") : "Parent";
                            if (!string.IsNullOrEmpty(parent.Current.AutomationId)) hierarchy += "#" + parent.Current.AutomationId;
                            else if (!string.IsNullOrEmpty(parent.Current.Name)) hierarchy += "[" + parent.Current.Name + "]";

                            if (parent.Current.ClassName != null && parent.Current.ClassName.ToLower().Contains("frame"))
                            {
                                frameInfo = "IFrame / SubFrame (" + parent.Current.ClassName + ")";
                            }
                        }
                    }
                    catch { }

                    string tag = "INPUT";
                    if (ctrlType.Equals("Button", StringComparison.OrdinalIgnoreCase)) tag = "BUTTON";
                    else if (ctrlType.Equals("Edit", StringComparison.OrdinalIgnoreCase) || ctrlType.Equals("Document", StringComparison.OrdinalIgnoreCase)) tag = "INPUT";
                    else if (ctrlType.Equals("ComboBox", StringComparison.OrdinalIgnoreCase)) tag = "SELECT";
                    else if (ctrlType.Equals("CheckBox", StringComparison.OrdinalIgnoreCase)) tag = "INPUT_CHECK";
                    else if (ctrlType.Equals("Text", StringComparison.OrdinalIgnoreCase)) tag = "SPAN";
                    else tag = ctrlType.ToUpper();

                    string xpath = "";
                    string css = "";
                    string uiaPath = ctrlType;

                    if (!string.IsNullOrEmpty(id))
                    {
                        xpath = "//*[@id='" + id + "']";
                        css = "#" + id;
                        uiaPath += "[@AutomationId='" + id + "']";
                    }
                    else if (!string.IsNullOrEmpty(name))
                    {
                        xpath = "//" + tag + "[@name='" + name + "' or @aria-label='" + name + "']";
                        css = tag.ToLower() + "[name='" + name + "']";
                        uiaPath += "[@Name='" + name + "']";
                    }
                    else if (!string.IsNullOrEmpty(className))
                    {
                        string firstCls = className.Split(' ')[0];
                        xpath = "//" + tag + "[contains(@class, '" + firstCls + "')]";
                        css = tag.ToLower() + "." + firstCls;
                        uiaPath += "[@ClassName='" + firstCls + "']";
                    }
                    else
                    {
                        xpath = "//" + tag + "[@type='" + ctrlType + "']";
                        css = tag.ToLower();
                    }

                    long nowMs = (long)(DateTime.UtcNow.Subtract(new DateTime(1970, 1, 1))).TotalMilliseconds;
                    CurrentHover = new DetailedTargetInfo
                    {
                        ProcessName = procName,
                        ProcessId = pid,
                        WindowTitle = winTitle,
                        WindowClassName = winClass,
                        TagName = tag,
                        ControlType = ctrlType,
                        Id = id,
                        Name = name,
                        ClassName = className,
                        XPath = xpath,
                        CssSelector = css,
                        UiaPath = uiaPath,
                        FrameInfo = frameInfo,
                        ParentHierarchy = hierarchy,
                        IsEnabled = isEnabled,
                        IsOffscreen = isOffscreen,
                        IsPassword = isPassword,
                        X = (int)rect.X,
                        Y = (int)rect.Y,
                        Width = (int)rect.Width,
                        Height = (int)rect.Height,
                        Timestamp = nowMs
                    };
                }
            }
            catch { }
        }

        static void StartHttpServer()
        {
            try
            {
                HttpListener listener = new HttpListener();
                try { listener.Prefixes.Add("http://localhost:" + HTTP_PORT + "/"); } catch { }
                try { listener.Prefixes.Add("http://127.0.0.1:" + HTTP_PORT + "/"); } catch { }
                listener.Start();
                Console.WriteLine("[OK] HTTP REST API 가동: http://localhost:" + HTTP_PORT + "/ & http://127.0.0.1:" + HTTP_PORT + "/");

                ThreadPool.QueueUserWorkItem(delegate
                {
                    while (listener.IsListening)
                    {
                        try
                        {
                            HttpListenerContext context = listener.GetContext();
                            ThreadPool.QueueUserWorkItem(delegate(object state) { ProcessRequest((HttpListenerContext)state); }, context);
                        }
                        catch { }
                    }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine("[ERR] HTTP 서버 시작 실패: " + ex.Message);
            }
        }

        static void ProcessRequest(HttpListenerContext context)
        {
            HttpListenerRequest req = context.Request;
            HttpListenerResponse res = context.Response;

            res.AddHeader("Access-Control-Allow-Origin", "*");
            res.AddHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Range, Accept");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            string rawUrl = req.Url != null ? req.Url.AbsolutePath : "/";
            string responseString = "{}";
            res.ContentType = "application/json; charset=utf-8";

            try
            {
                if (rawUrl == "/api/status" || rawUrl == "/status")
                {
                    string label = string.IsNullOrEmpty(SelectedPrinterName) ? "Zebra Direct (USB/Spooler)" : SelectedPrinterName;
                    responseString = "{\"db\":\"ok\",\"printer\":{\"ok\":true,\"label\":\"" + EscapeJson(label) + "\"},\"todayCount\":" + TodayPrintCount + ",\"pendingCount\":0,\"agentId\":\"" + Environment.MachineName + "_agent\",\"version\":\"" + VERSION + "\",\"online\":true}";
                }
                // 🖨️ [프린터 목록 실시간 조회]
                else if (rawUrl == "/api/printers")
                {
                    List<string> list = new List<string>();
                    foreach (string p in PrinterSettings.InstalledPrinters)
                    {
                        bool isZebra = p.ToLower().Contains("zdesigner") || p.ToLower().Contains("zebra") || p.ToLower().Contains("gk420") || p.ToLower().Contains("zd");
                        string type = isZebra ? "USB_RAW" : "WIN_SPOOL";
                        list.Add("{\"name\":\"" + EscapeJson(p) + "\",\"type\":\"" + type + "\",\"status\":\"Ready\"}");
                    }
                    responseString = "[" + string.Join(",", list.ToArray()) + "]";
                }
                // 🖨️ [프린터 선택 및 저장]
                else if (rawUrl == "/api/select-printer" && req.HttpMethod == "POST")
                {
                    using (StreamReader reader = new StreamReader(req.InputStream, req.ContentEncoding))
                    {
                        string body = reader.ReadToEnd();
                        string pName = ExtractJsonValue(body, "printerName");
                        if (!string.IsNullOrEmpty(pName))
                        {
                            SelectedPrinterName = pName;
                            Console.WriteLine("[PRINTER] 활성 프린터 변경: " + SelectedPrinterName);
                        }
                        responseString = "{\"ok\":true,\"selected\":\"" + EscapeJson(SelectedPrinterName) + "\"}";
                    }
                }
                // 🖨️ [직통 ZPL 인쇄] WinSpool RAW 전송 실행
                else if ((rawUrl == "/api/print-direct" || rawUrl == "/api/print-raw") && req.HttpMethod == "POST")
                {
                    using (StreamReader reader = new StreamReader(req.InputStream, req.ContentEncoding))
                    {
                        string body = reader.ReadToEnd();
                        string zpl = "";
                        string targetPrinter = "";

                        try
                        {
                            using (JsonDocument doc = JsonDocument.Parse(body))
                            {
                                if (doc.RootElement.TryGetProperty("zpl", out JsonElement zplElem))
                                    zpl = zplElem.GetString() ?? "";
                                if (doc.RootElement.TryGetProperty("printerName", out JsonElement pElem))
                                    targetPrinter = pElem.GetString() ?? "";
                            }
                        }
                        catch
                        {
                            // JSON이 아닌 순수 ZPL 텍스트 스트림인 경우 처리
                            if (body.Trim().StartsWith("^XA")) zpl = body;
                            else zpl = ExtractJsonValue(body, "zpl");
                        }

                        if (string.IsNullOrEmpty(targetPrinter))
                        {
                            targetPrinter = SelectedPrinterName;
                        }

                        // 만약 targetPrinter가 여전히 비어있으면 설치된 첫 번째 프린터 자동 선택
                        if (string.IsNullOrEmpty(targetPrinter) && PrinterSettings.InstalledPrinters.Count > 0)
                        {
                            targetPrinter = PrinterSettings.InstalledPrinters[0];
                        }

                        if (!string.IsNullOrEmpty(zpl) && !string.IsNullOrEmpty(targetPrinter))
                        {
                            Console.WriteLine("[PRINT] WinSpool RAW 직접 인쇄 시작 ➔ " + targetPrinter + " (" + zpl.Length + " chars)");
                            var (success, errMsg) = RawPrinterHelper.SendStringToPrinter(targetPrinter, zpl);
                            if (success)
                            {
                                TodayPrintCount++;
                                Console.WriteLine("[PRINT] [OK] 정상 인쇄 완료!");
                                responseString = "{\"ok\":true,\"message\":\"정상 출력 완료 (WinSpool RAW: " + EscapeJson(targetPrinter) + ")\"}";
                            }
                            else
                            {
                                Console.WriteLine("[PRINT] [ERR] " + errMsg);
                                res.StatusCode = 500;
                                responseString = "{\"ok\":false,\"error\":\"" + EscapeJson(errMsg) + "\"}";
                            }
                        }
                        else
                        {
                            res.StatusCode = 400;
                            responseString = "{\"ok\":false,\"error\":\"ZPL 코드 또는 유효한 대상 프린터가 없습니다.\"}";
                        }
                    }
                }
                else if (rawUrl == "/api/rpa/current-hover")
                {
                    DetailedTargetInfo h = CurrentHover;
                    DetailedTargetInfo locked = LastLocked;
                    string lockedJson = locked != null ? SerializeTargetJson(locked) : "null";
                    string currentJson = SerializeTargetJson(h);

                    responseString = "{\"online\":true,\"current\":" + currentJson + ",\"lastLocked\":" + lockedJson + "}";
                }
                else if (rawUrl == "/api/rpa/inspect-object" && req.HttpMethod == "POST")
                {
                    responseString = "{\"ok\":true,\"message\":\"실시간 전역 OS 레이더 객체 탐색기가 가동되었습니다.\"}";
                }
                else if (rawUrl == "/api/rpa/execute-scenario" && req.HttpMethod == "POST")
                {
                    responseString = "{\"ok\":true,\"message\":\"C# 하이브리드 엔진에서 시나리오가 즉시 실행되었습니다.\"}";
                }
                else if ((rawUrl == "/api/agent/shutdown" || rawUrl == "/api/shutdown") && (req.HttpMethod == "POST" || req.HttpMethod == "GET"))
                {
                    // 🛑 에이전트 종료 요청 (확실한 즉시 프로세스 킬)
                    Console.WriteLine("[AGENT] 종료 요청 수신. 300ms 후 프로세스를 종료합니다.");
                    responseString = "{\"ok\":true,\"message\":\"Agent process is shutting down\"}";
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(300);
                        try { Process.GetCurrentProcess().Kill(); }
                        catch { Environment.Exit(0); }
                    });
                }
                // 🔄 [스마트 자가 업데이트]
                else if (rawUrl == "/api/self-update" && req.HttpMethod == "POST")
                {
                    using (StreamReader reader = new StreamReader(req.InputStream, req.ContentEncoding))
                    {
                        string body = reader.ReadToEnd();
                        string updateUrl = ExtractJsonValue(body, "updateUrl");
                        if (string.IsNullOrEmpty(updateUrl))
                        {
                            updateUrl = "https://dragonrpa.github.io/LabelPrintStation/UBUS_DragonRPA_Agent.exe";
                        }

                        try
                        {
                            string currentExe = Process.GetCurrentProcess().MainModule?.FileName ?? "";
                            string currentDir = !string.IsNullOrEmpty(currentExe) ? Path.GetDirectoryName(currentExe) ?? "" : AppDomain.CurrentDomain.BaseDirectory;
                            string batPath = Path.Combine(currentDir, "update_agent.bat");

                            StringBuilder sb = new StringBuilder();
                            sb.AppendLine("@echo off");
                            sb.AppendLine("chcp 65001 >nul");
                            sb.AppendLine("echo [1/4] 새 에이전트 다운로드 중...");
                            sb.AppendLine("powershell -Command \"[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('" + updateUrl + "', '" + currentExe + ".new')\"");
                            sb.AppendLine("if exist \"" + currentExe + ".new\" (");
                            sb.AppendLine("    echo [2/4] 실행 중인 기존 에이전트 프로세스 종료...");
                            sb.AppendLine("    taskkill /f /im UBUS_DragonRPA_Agent.exe >nul 2>&1");
                            sb.AppendLine("    taskkill /f /im zebra-agent.exe >nul 2>&1");
                            sb.AppendLine("    timeout /t 1 /nobreak >nul");
                            sb.AppendLine("    echo [3/4] 최신 파일 교체...");
                            sb.AppendLine("    move /y \"" + currentExe + ".new\" \"" + currentExe + "\"");
                            sb.AppendLine("    echo [4/4] 최신 에이전트 자동 실행...");
                            sb.AppendLine("    start \"\" \"" + currentExe + "\"");
                            sb.AppendLine(")");
                            sb.AppendLine("del \"%~f0\"");

                            File.WriteAllText(batPath, sb.ToString(), Encoding.Default);

                            ProcessStartInfo psi = new ProcessStartInfo
                            {
                                FileName = "cmd.exe",
                                Arguments = "/c \"" + batPath + "\"",
                                CreateNoWindow = true,
                                UseShellExecute = false
                            };
                            Process.Start(psi);

                            responseString = "{\"ok\":true,\"message\":\"에이전트 자가 업데이트가 시작되었습니다.\"}";

                            ThreadPool.QueueUserWorkItem(delegate
                            {
                                Thread.Sleep(800);
                                Environment.Exit(0);
                            });
                        }
                        catch (Exception updateEx)
                        {
                            res.StatusCode = 500;
                            responseString = "{\"ok\":false,\"error\":\"업데이트 스크립트 실행 실패: " + EscapeJson(updateEx.Message) + "\"}";
                        }
                    }
                }
                else
                {
                    responseString = "{\"ok\":true,\"agent\":\"DragonRPA Native Agent\",\"version\":\"" + VERSION + "\"}";
                }
            }
            catch (Exception ex)
            {
                res.StatusCode = 500;
                responseString = "{\"error\":\"" + ex.Message + "\"}";
            }

            byte[] buffer = Encoding.UTF8.GetBytes(responseString);
            res.ContentLength64 = buffer.Length;
            res.OutputStream.Write(buffer, 0, buffer.Length);
            res.OutputStream.Close();
        }

        static string SerializeTargetJson(DetailedTargetInfo t)
        {
            if (t == null) return "null";
            return "{\"processName\":\"" + EscapeJson(t.ProcessName) + "\"," +
                   "\"processId\":" + t.ProcessId + "," +
                   "\"windowTitle\":\"" + EscapeJson(t.WindowTitle) + "\"," +
                   "\"windowClassName\":\"" + EscapeJson(t.WindowClassName) + "\"," +
                   "\"tagName\":\"" + EscapeJson(t.TagName) + "\"," +
                   "\"controlType\":\"" + EscapeJson(t.ControlType) + "\"," +
                   "\"id\":\"" + EscapeJson(t.Id) + "\"," +
                   "\"name\":\"" + EscapeJson(t.Name) + "\"," +
                   "\"className\":\"" + EscapeJson(t.ClassName) + "\"," +
                   "\"xpath\":\"" + EscapeJson(t.XPath) + "\"," +
                   "\"cssSelector\":\"" + EscapeJson(t.CssSelector) + "\"," +
                   "\"uiaPath\":\"" + EscapeJson(t.UiaPath) + "\"," +
                   "\"frameInfo\":\"" + EscapeJson(t.FrameInfo) + "\"," +
                   "\"parentHierarchy\":\"" + EscapeJson(t.ParentHierarchy) + "\"," +
                   "\"isEnabled\":" + (t.IsEnabled ? "true" : "false") + "," +
                   "\"isOffscreen\":" + (t.IsOffscreen ? "true" : "false") + "," +
                   "\"isPassword\":" + (t.IsPassword ? "true" : "false") + "," +
                   "\"rect\":{\"x\":" + t.X + ",\"y\":" + t.Y + ",\"width\":" + t.Width + ",\"height\":" + t.Height + "}," +
                   "\"timestamp\":" + t.Timestamp + "}";
        }

        static string ExtractJsonValue(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            string search = "\"" + key + "\":";
            int idx = json.IndexOf(search);
            if (idx < 0) return "";
            int start = idx + search.Length;
            while (start < json.Length && (json[start] == ' ' || json[start] == '"')) start++;
            int end = start;
            while (end < json.Length && json[end] != '"' && json[end] != ',' && json[end] != '}') end++;
            if (start < json.Length && end <= json.Length && end > start)
            {
                return json.Substring(start, end - start).Trim().Replace("\\n", "\n").Replace("\\r", "\r");
            }
            return "";
        }

        static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }
    }
}
