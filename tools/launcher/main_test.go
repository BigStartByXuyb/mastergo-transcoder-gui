package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// 造一个「像 Node 的 zip」：第一层目录 + node.exe。内容随便，够验解压与剥层。
func makeZip(t *testing.T, dir string, name string, withTopDir bool) (string, string) {
	t.Helper()
	path := filepath.Join(dir, name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("建包失败：%v", err)
	}
	writer := zip.NewWriter(file)
	entryName := "node.exe"
	if withTopDir {
		entryName = "node-v1.2.3-win-x64/node.exe"
	}
	entry, err := writer.Create(entryName)
	if err != nil {
		t.Fatalf("写条目失败：%v", err)
	}
	if _, err := entry.Write([]byte("fake-node")); err != nil {
		t.Fatalf("写内容失败：%v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("收包失败：%v", err)
	}
	file.Close()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读包失败：%v", err)
	}
	sum := sha256.Sum256(raw)
	return path, hex.EncodeToString(sum[:])
}

func specFor(sum string, strip int) toolSpec {
	return toolSpec{
		Version:     "1.2.3",
		FileName:    "node-v1.2.3-win-x64.zip",
		SHA256:      sum,
		OfficialURL: "https://example.invalid/node.zip",
		Strip:       strip,
		Exe:         "node.exe",
	}
}

// 解压：剥掉第一层、落到版本目录、写指针 —— 中途失败不许留下「像装好了」的目录。
func TestUnpackStripsTopDirAndWritesPointer(t *testing.T) {
	root := t.TempDir()
	blob, sum := makeZip(t, t.TempDir(), "node.zip", true)
	spec := specFor(sum, 1)

	exe, err := unpack(blob, root, spec)
	if err != nil {
		t.Fatalf("解压失败：%v", err)
	}
	if _, err := os.Stat(exe); err != nil {
		t.Fatalf("解压后应有 node.exe：%v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "runtime", "node", ".building-"+strconv.Itoa(os.Getpid()))); err == nil {
		t.Fatal("临时目录要清掉")
	}
	pointer := filepath.Join(root, "runtime", "node", "current.json")
	raw, err := os.ReadFile(pointer)
	if err != nil {
		t.Fatalf("要写指针：%v", err)
	}
	if !strings.Contains(string(raw), "1.2.3") {
		t.Fatalf("指针里要有版本号，实际：%s", raw)
	}
	// bundledNode 按指针找得到这一份
	if got := bundledNode(root); got != exe {
		t.Fatalf("按指针找到的应是 %s，实际 %s", exe, got)
	}
}

// 下载：先按官方地址取，校验不过要把坏包删掉（不能留在缓存里冒充好的）。
func TestFetchZipVerifiesAndKeepsBlob(t *testing.T) {
	root := t.TempDir()
	_, sum := makeZip(t, t.TempDir(), "node.zip", true)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		bad, _ := os.CreateTemp(t.TempDir(), "bad-*.zip")
		bad.WriteString("not-a-zip")
		bad.Close()
		raw, _ := os.ReadFile(bad.Name())
		_, _ = writer.Write(raw)
	}))
	defer server.Close()

	spec := specFor(sum, 1)
	spec.OfficialURL = server.URL + "/" + spec.FileName
	blob, err := fetchZip(root, spec, "")
	if err != nil {
		t.Fatalf("下载失败：%v", err)
	}
	got, err := fileSHA256(blob)
	if err != nil {
		t.Fatalf("算哈希失败：%v", err)
	}
	if strings.EqualFold(got, spec.SHA256) {
		t.Fatal("这份内容是坏的，哈希不该对得上")
	}

	// 组合起来：ensureNode 见到坏包 → 校验不过 → 删掉它并报错
	if _, err := ensureNode(root, spec, ""); err == nil {
		t.Fatal("坏包必须报错，不许当装好了")
	}
	if _, err := os.Stat(blob); err == nil {
		t.Fatal("校验不过的缓存要删掉")
	}
}

// 有 blob 就不再下载：把指针指到 blob 上，正好验「本地缓存直接用」这条路。
func TestFetchZipUsesBlobFirst(t *testing.T) {
	root := t.TempDir()
	blob, sum := makeZip(t, t.TempDir(), "cached.zip", true)
	spec := specFor(sum, 1)
	spec.OfficialURL = "https://example.invalid/should-not-be-used.zip"
	target := filepath.Join(root, "runtime", "blobs", sum)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("建目录失败：%v", err)
	}
	raw, _ := os.ReadFile(blob)
	if err := os.WriteFile(target, raw, 0o644); err != nil {
		t.Fatalf("放缓存失败：%v", err)
	}
	got, err := fetchZip(root, spec, "")
	if err != nil {
		t.Fatalf("用缓存也不该失败：%v", err)
	}
	if got != target {
		t.Fatalf("应当直接用缓存 %s，实际 %s", target, got)
	}
}

func TestMajorVersion(t *testing.T) {
	if majorVersion("v24.21.0\n") != 24 {
		t.Fatal("带 v 与前导空白的版本号要认出来")
	}
	if majorVersion("nonsense") != 0 {
		t.Fatal("认不出来就是 0（当作不能用）")
	}
}
