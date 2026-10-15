// mastergo-transcoder.exe —— 绿色包与 winget portable 包的启动器。
//
// 它只做一件事：**在没有 Node 的机器上也能把客户端拉起来**。
// 今天 start.cmd 自己就要 Node，机器上没有它连脚本都跑不起来，所以「启动后再检测」是来不及的；
// 这个不依赖任何东西的 exe 正好补上这一段。
//
// 顺序（有就用，没有才下）：
//  1. 我们自己的那份：runtime\node\<版本>\node.exe
//  2. 系统 PATH 上的 node（版本够新就用，并提示「版本不受我们控制」）
//  3. 都没有：按下表从「安装包来源」取（内网镜像基址在 local.json 的 runtime.mirror；空＝官方地址）
//     → 校验 sha256 → 解压到 runtime\node\<版本>\ → 写指针 → 再起
//     包里那份 zip 如果已经在 runtime\blobs\<sha256> 里，直接用它，不再下载。
//
// 两处与 Node 侧（lib/runtime.js）的关系，写在明处：
//   * 「自带那份在哪」两边各实现一次：Go 这边读不懂 JS。共同的契约只有布局本身
//     （runtime\<工具>\<版本>\ + current.json 指针 + current 链接），改布局要同时改两处。
//   * 「用系统 node 起客户端」是有意为之：启动器只负责把客户端拉起来，不负责版本一致性 ——
//     版本对齐靠界面「运行环境」里点一下下载（下完下次启动就走第 1 条）。客户机上那份够新时，
//     不为了这份运行时卡住第一次启动。设置里选过「系统上那一份」的，与这条自然一致。
//   * 下载不带凭据（token 是 DPAPI 加密的，Go 解不开）：给启动器用的内网镜像应当免凭据；
//     需要凭据的场景走 Node 侧那条下载（它能解密 token）。
//
// 不是安装器：不写注册表、不装服务、不碰别的目录，卸载=删目录。
// PowerShell 7 不归它管：能起到这一步就说明 Node 已经有了，那一份在界面里点「下载」即可。
package main

import (
	"archive/zip"
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	entry        = "launch.js"
	assetsFile   = "runtime-assets.json"
	nodeTool     = "node"
	minMajorNode = 18
)

type toolSpec struct {
	Version     string `json:"version"`
	FileName    string `json:"fileName"`
	SHA256      string `json:"sha256"`
	OfficialURL string `json:"officialUrl"`
	Strip       int    `json:"strip"`
	Exe         string `json:"exe"`
}

type assetsFileShape struct {
	Tools map[string]toolSpec `json:"tools"`
}

type nodePointer struct {
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	Installed string `json:"installedAt"`
}

func installRoot() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	// winget 的 shim 是指向包内真身的链接：解析成真实路径，否则会定位到 WinGet\Links。
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	root := filepath.Dir(exe)
	if _, err := os.Stat(filepath.Join(root, entry)); err != nil {
		return "", fmt.Errorf("这个目录里没有 %s：%s", entry, root)
	}
	return root, nil
}

func readJSON(path string, into any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

/* 安装包里带的那份钉死表。 */
func readAssets(root string) (toolSpec, error) {
	var shape assetsFileShape
	if err := readJSON(filepath.Join(root, assetsFile), &shape); err != nil {
		return toolSpec{}, fmt.Errorf("读不到 %s：%w", assetsFile, err)
	}
	spec, ok := shape.Tools[nodeTool]
	if !ok || spec.Version == "" || spec.SHA256 == "" {
		return toolSpec{}, fmt.Errorf("%s 里没有 node 的条目", assetsFile)
	}
	return spec, nil
}

/* 安装包来源：设置里那个内网镜像基址（空＝官方地址）。 */
func mirrorOf(root string) string {
	var cfg struct {
		Runtime struct {
			Mirror string `json:"mirror"`
		} `json:"runtime"`
	}
	if err := readJSON(filepath.Join(root, "local.json"), &cfg); err != nil {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(cfg.Runtime.Mirror), "/")
}

/* 我们自己的那份：按指针找 runtime\node\<版本>\<exe>。 */
func bundledNode(root string) string {
	var pointer nodePointer
	if err := readJSON(filepath.Join(root, "runtime", nodeTool, "current.json"), &pointer); err != nil || pointer.Version == "" {
		return ""
	}
	exe := filepath.Join(root, "runtime", nodeTool, pointer.Version, "node.exe")
	if _, err := os.Stat(exe); err != nil {
		return ""
	}
	return exe
}

/* 系统上那份：PATH 上找，并确认它是能干活的版本（太老的不算）。 */
func systemNode() string {
	exe, err := exec.LookPath("node.exe")
	if err != nil {
		exe, err = exec.LookPath("node")
		if err != nil {
			return ""
		}
	}
	out, err := exec.Command(exe, "-v").Output()
	if err != nil {
		return ""
	}
	if majorVersion(string(out)) < minMajorNode {
		return ""
	}
	return exe
}

func majorVersion(text string) int {
	clean := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(text), "v"))
	first := strings.SplitN(clean, ".", 2)[0]
	value, err := strconv.Atoi(first)
	if err != nil {
		return 0
	}
	return value
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

/* 有 blob 就直接用（同一个哈希在不同版本里是同一份内容），没有才下。 */
func fetchZip(root string, spec toolSpec, mirror string) (string, error) {
	blob := filepath.Join(root, "runtime", "blobs", spec.SHA256)
	if _, err := os.Stat(blob); err == nil {
		fmt.Println("安装包已在本地缓存里，直接用。")
		return blob, nil
	}
	url := spec.OfficialURL
	if mirror != "" {
		url = mirror + "/" + spec.FileName
	}
	fmt.Println("正在下载 Node.js " + spec.Version + "：" + url)
	client := &http.Client{Timeout: 30 * time.Minute}
	// 网络抖一下就报「补运行时失败」太钝：两次机会，第一次失败等 2 秒。
	var lastErr error
	for attempt := 1; attempt <= 2; attempt += 1 {
		lastErr = downloadTo(client, url, blob)
		if lastErr == nil {
			return blob, nil
		}
		if attempt < 2 {
			fmt.Println("这次没成（" + lastErr.Error() + "），2 秒后再试一次。")
			time.Sleep(2 * time.Second)
		}
	}
	return "", lastErr
}

func downloadTo(client *http.Client, url string, blob string) error {
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载失败：HTTP %d（%s）", response.StatusCode, url)
	}
	if err := os.MkdirAll(filepath.Dir(blob), 0o755); err != nil {
		return err
	}
	out, err := os.Create(blob)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, response.Body); err != nil {
		out.Close()
		os.Remove(blob)
		return err
	}
	out.Close()
	return nil
}

/* 把 zip 解到 staging：第一层（Node 的包带一层 node-v…/）按 strip 剥掉。 */
func unzipTo(blob string, staging string, spec toolSpec) error {
	archive, err := zip.OpenReader(blob)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, item := range archive.File {
		parts := strings.SplitN(filepath.ToSlash(item.Name), "/", spec.Strip+1)
		if spec.Strip > 0 && len(parts) <= spec.Strip {
			continue
		}
		rel := parts[len(parts)-1]
		if rel == "" || strings.HasPrefix(rel, "..") {
			continue
		}
		destination := filepath.Join(staging, filepath.FromSlash(rel))
		if item.FileInfo().IsDir() || strings.HasSuffix(item.Name, "/") {
			if err := os.MkdirAll(destination, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return err
		}
		source, err := item.Open()
		if err != nil {
			return err
		}
		file, err := os.Create(destination)
		if err != nil {
			source.Close()
			return err
		}
		if _, err := io.Copy(file, source); err != nil {
			file.Close()
			source.Close()
			return err
		}
		file.Close()
		source.Close()
	}
	return nil
}

/* 把拼好的那一份搬进版本目录，并写下「当前生效的是哪一版」。 */
func publish(staging string, target string, root string, spec toolSpec) error {
	if _, err := os.Stat(filepath.Join(staging, spec.Exe)); err != nil {
		return fmt.Errorf("解压后没找到 %s", spec.Exe)
	}
	os.RemoveAll(target)
	if err := os.Rename(staging, target); err != nil {
		return err
	}
	pointer, _ := json.MarshalIndent(nodePointer{
		Version:   spec.Version,
		SHA256:    spec.SHA256,
		Installed: time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	_ = os.WriteFile(filepath.Join(root, "runtime", nodeTool, "current.json"), append(pointer, '\n'), 0o644)
	return nil
}

/* current 链接是 start.cmd 用的稳定入口；建不了（非 NTFS、没权限）不影响程序本身。 */
func refreshLink(root string, target string) {
	link := filepath.Join(root, "runtime", nodeTool, "current")
	os.Remove(link)
	_ = exec.Command("cmd", "/c", "mklink", "/J", link, target).Run()
}

/*
 * 解压到版本目录：先拼到 .building-<pid>，成功了才搬过去 —— 中途失败不会留下一个「像装好了」的目录。
 * 三件事分开：拼（unzipTo）→ 搬 + 写指针（publish）→ 建 current 链接（refreshLink）。
 */
func unpack(blob string, root string, spec toolSpec) (string, error) {
	staging := filepath.Join(root, "runtime", nodeTool, ".building-"+strconv.Itoa(os.Getpid()))
	target := filepath.Join(root, "runtime", nodeTool, spec.Version)
	os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return "", err
	}

	if err := unzipTo(blob, staging, spec); err != nil {
		os.RemoveAll(staging)
		return "", err
	}

	if err := publish(staging, target, root, spec); err != nil {
		os.RemoveAll(staging)
		return "", err
	}
	refreshLink(root, target)
	return filepath.Join(target, spec.Exe), nil
}

/* 缺就补：blob → 校验 → 解压。返回我们那份 node.exe 的路径。 */
func ensureNode(root string, spec toolSpec, mirror string) (string, error) {
	if existing := bundledNode(root); existing != "" {
		return existing, nil
	}
	fmt.Println("没有找到客户端自带的 Node.js " + spec.Version + "，准备补上。")
	blob, err := fetchZip(root, spec, mirror)
	if err != nil {
		return "", err
	}
	sum, err := fileSHA256(blob)
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(sum, spec.SHA256) {
		// 缓存里那份对不上（半截下载、被人动过）：删掉，下一次重新下。
		os.Remove(blob)
		return "", fmt.Errorf("安装包校验不过：期望 %s，实际 %s", spec.SHA256[:12], sum[:12])
	}
	fmt.Println("校验通过，解压到 runtime\\" + nodeTool + "\\" + spec.Version + " …")
	return unpack(blob, root, spec)
}

func pause() {
	info, err := os.Stdin.Stat()
	if err != nil || (info.Mode()&os.ModeCharDevice) == 0 {
		return
	}
	fmt.Fprint(os.Stderr, "按回车关闭…")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

func runClient(root string, nodeExe string) error {
	args := append([]string{filepath.Join(root, entry)}, os.Args[1:]...)
	cmd := exec.Command(nodeExe, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "MASTERGO_HOME="+root)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}

func main() {
	root, err := installRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "启动失败："+err.Error())
		pause()
		os.Exit(1)
	}

	spec, err := readAssets(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "启动失败："+err.Error())
		pause()
		os.Exit(1)
	}

	// 有就用：自带 → 系统 PATH 上那份；都没有才下载。
	nodeExe := bundledNode(root)
	if nodeExe == "" {
		nodeExe = systemNode()
		if nodeExe != "" {
			fmt.Println("这次用系统上装的 Node：" + nodeExe)
			fmt.Println("版本不受我们控制；想换成客户端自带那份，进界面「运行环境」点一下下载。")
		}
	}
	if nodeExe == "" {
		nodeExe, err = ensureNode(root, spec, mirrorOf(root))
		if err != nil {
			fmt.Fprintln(os.Stderr, "补运行时失败："+err.Error())
			fmt.Fprintln(os.Stderr, "外网取不到时：把 Node 的 zip 放到内网一个能 HTTP 访问的目录，在界面「运行环境 → 来源」里填那个地址。")
			pause()
			os.Exit(1)
		}
	}

	// 只补齐、不起客户端：排障用（也能在自动化里验「缺什么补什么」这条链）。
	for _, arg := range os.Args[1:] {
		if arg == "--check-runtime" {
			fmt.Println("运行时已就绪：" + nodeExe)
			return
		}
	}

	if err := runClient(root, nodeExe); err != nil {
		fmt.Fprintln(os.Stderr, "客户端退出："+err.Error())
		pause()
		os.Exit(1)
	}
}
