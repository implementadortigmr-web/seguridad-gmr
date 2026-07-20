import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary detectó un error:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            background: "#f8fafc",
            color: "#0f172a",
            fontFamily: "Arial, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: 720,
              margin: "40px auto",
              padding: 24,
              borderRadius: 18,
              background: "white",
              border: "1px solid #e2e8f0",
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
            }}
          >
            <h1 style={{ marginTop: 0, color: "#b91c1c" }}>
              Error al cargar la app
            </h1>

            <p>
              La app encontró un error de JavaScript. Copia este mensaje o toma
              captura para corregirlo.
            </p>

            <pre
              style={{
                padding: 14,
                borderRadius: 12,
                background: "#0f172a",
                color: "#f8fafc",
                overflowX: "auto",
                fontSize: 13,
                whiteSpace: "pre-wrap",
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </pre>

            {this.state.errorInfo?.componentStack && (
              <pre
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: "#1e293b",
                  color: "#f8fafc",
                  overflowX: "auto",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                }}
              >
                {this.state.errorInfo.componentStack}
              </pre>
            )}

            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: "12px 18px",
                border: 0,
                borderRadius: 12,
                background: "#0f5d75",
                color: "white",
                fontWeight: 700,
              }}
            >
              Recargar app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}