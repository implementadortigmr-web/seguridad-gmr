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
    console.error("Error capturado por ErrorBoundary:", error);
    console.error("Component stack:", errorInfo);

    this.setState({
      error,
      errorInfo,
    });
  }

  copyError = async () => {
    const errorText = `
Mensaje:
${this.state.error?.message || "Sin mensaje"}

Stack:
${this.state.error?.stack || "Sin stack"}

Component stack:
${this.state.errorInfo?.componentStack || "Sin component stack"}
`;

    try {
      await navigator.clipboard.writeText(errorText);
      alert("Error copiado.");
    } catch {
      alert(errorText);
    }
  };

  reloadApp = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="error-page">
        <section className="error-card">
          <h1>Error al cargar la app</h1>

          <p>
            La app encontró un error de JavaScript. Copia este mensaje o toma
            captura para corregirlo.
          </p>

          <h3>Mensaje</h3>
          <pre>{this.state.error?.message || "Error desconocido"}</pre>

          <h3>Stack técnico</h3>
          <pre>{this.state.error?.stack || "Sin stack disponible"}</pre>

          <h3>Componente</h3>
          <pre>
            {this.state.errorInfo?.componentStack ||
              "Sin información del componente"}
          </pre>

          <div className="error-actions">
            <button type="button" className="primary-button" onClick={this.copyError}>
              Copiar error
            </button>

            <button type="button" className="secondary-button" onClick={this.reloadApp}>
              Recargar app
            </button>
          </div>
        </section>
      </main>
    );
  }
}